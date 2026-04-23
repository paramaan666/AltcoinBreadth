from __future__ import annotations

from copy import deepcopy
from dataclasses import asdict
from datetime import UTC, date, datetime
import re
from typing import Any

import polars as pl

from livealt.binance_client import UniverseSymbol
from livealt.config import UniverseConfig


VALID_SYMBOL_RE = re.compile(r"^[A-Z0-9]+USDT$")


def is_valid_symbol_name(symbol: str) -> bool:
    return bool(VALID_SYMBOL_RE.fullmatch(symbol))


def filter_universe_symbols(
    raw_symbols: list[dict[str, Any]],
    config: UniverseConfig,
) -> list[UniverseSymbol]:
    symbols: list[UniverseSymbol] = []
    for item in raw_symbols:
        symbol = item.get("symbol")
        if not symbol or symbol in config.exclude_symbols:
            continue
        if not is_valid_symbol_name(symbol):
            continue
        if item.get("quoteAsset") != config.quote_asset:
            continue
        if item.get("contractType") != config.required_contract_type:
            continue
        if item.get("status") != config.required_status:
            continue
        onboard_date = _parse_binance_date(item.get("onboardDate"))
        symbols.append(
            UniverseSymbol(
                symbol=symbol,
                base_asset=item.get("baseAsset", ""),
                quote_asset=item.get("quoteAsset", ""),
                contract_type=item.get("contractType", ""),
                status=item.get("status", ""),
                onboard_date=onboard_date,
            )
        )
    return sorted(symbols, key=lambda entry: entry.symbol)


def build_snapshot_payload(snapshot_date: date, symbols: list[UniverseSymbol]) -> dict[str, Any]:
    return {
        "snapshot_date": snapshot_date.isoformat(),
        "count": len(symbols),
        "symbols": [
            {
                **asdict(symbol),
                "onboard_date": symbol.onboard_date.isoformat() if symbol.onboard_date else None,
            }
            for symbol in symbols
        ],
    }


def build_snapshot_history_frame(snapshot_date: date, symbols: list[UniverseSymbol]) -> pl.DataFrame:
    return pl.DataFrame(
        {
            "snapshot_date": [snapshot_date] * len(symbols),
            "symbol": [symbol.symbol for symbol in symbols],
            "base_asset": [symbol.base_asset for symbol in symbols],
            "quote_asset": [symbol.quote_asset for symbol in symbols],
            "contract_type": [symbol.contract_type for symbol in symbols],
        }
    )


def merge_registry_with_observations(
    existing_registry: dict[str, Any],
    snapshot_date: date,
    active_symbols: list[UniverseSymbol],
    data_ranges: dict[str, dict[str, str | None]],
    confirmation_days: int,
) -> dict[str, Any]:
    registry = deepcopy(existing_registry)
    active_map = {symbol.symbol: symbol for symbol in active_symbols}
    active_set = set(active_map)

    for symbol, ranges in data_ranges.items():
        entry = registry.setdefault(symbol, _empty_registry_entry(symbol))
        first_data = ranges.get("first_data_date")
        last_data = ranges.get("last_data_date")
        if first_data:
            entry["first_data_date"] = first_data
            entry["listing_date_inferred"] = _min_date_string(
                entry.get("listing_date_inferred"),
                first_data,
            )
        if last_data:
            entry["last_data_date"] = last_data
        if symbol not in active_set and last_data and last_data < snapshot_date.isoformat():
            entry["status"] = entry.get("status") or "delisted"
            entry["delisted_date_inferred"] = entry.get("delisted_date_inferred") or last_data

    for symbol, info in active_map.items():
        entry = registry.setdefault(symbol, _empty_registry_entry(symbol))
        entry["first_seen_date"] = entry.get("first_seen_date") or snapshot_date.isoformat()
        entry["last_seen_active_date"] = snapshot_date.isoformat()
        entry["missing_snapshots"] = 0
        entry["status"] = "active"
        entry["delisted_date_inferred"] = None
        if info.onboard_date:
            onboard_str = info.onboard_date.isoformat()
            entry["onboard_date"] = onboard_str
            entry["listing_date_inferred"] = _min_date_string(
                entry.get("listing_date_inferred"),
                onboard_str,
            )
        entry["listing_date_inferred"] = _min_date_string(
            entry.get("listing_date_inferred"),
            entry.get("first_data_date"),
            entry.get("first_seen_date"),
        )

    for symbol, entry in registry.items():
        if symbol in active_set:
            continue
        if entry.get("status") == "delisted" and entry.get("delisted_date_inferred"):
            continue
        if entry.get("last_seen_active_date"):
            missing = int(entry.get("missing_snapshots", 0)) + 1
            entry["missing_snapshots"] = missing
            if missing >= confirmation_days:
                entry["status"] = "delisted"
                entry["delisted_date_inferred"] = _min_date_string(
                    entry.get("last_seen_active_date"),
                    entry.get("last_data_date"),
                )
            else:
                entry["status"] = "candidate_delisted"
        elif entry.get("last_data_date") and entry["last_data_date"] < snapshot_date.isoformat():
            entry["status"] = "delisted"
            entry["delisted_date_inferred"] = entry.get("last_data_date")
        entry["listing_date_inferred"] = _min_date_string(
            entry.get("listing_date_inferred"),
            entry.get("first_data_date"),
            entry.get("first_seen_date"),
        )
    return registry


def lifecycle_for_date(entry: dict[str, Any], on_date: date) -> bool:
    start = _parse_iso_date(entry.get("listing_date_inferred"))
    end = _parse_iso_date(entry.get("delisted_date_inferred"))
    if start and on_date < start:
        return False
    if end and on_date > end:
        return False
    return True


def registry_summary(registry: dict[str, Any]) -> dict[str, int]:
    counts = {"active": 0, "candidate_delisted": 0, "delisted": 0, "unknown": 0}
    for entry in registry.values():
        status = entry.get("status", "unknown")
        counts[status] = counts.get(status, 0) + 1
    return counts


def _empty_registry_entry(symbol: str) -> dict[str, Any]:
    return {
        "symbol": symbol,
        "status": "unknown",
        "first_seen_date": None,
        "last_seen_active_date": None,
        "first_data_date": None,
        "last_data_date": None,
        "onboard_date": None,
        "listing_date_inferred": None,
        "delisted_date_inferred": None,
        "missing_snapshots": 0,
    }


def _parse_binance_date(value: int | None) -> date | None:
    if not value:
        return None
    return datetime.fromtimestamp(int(value) / 1000, tz=UTC).date()


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)


def _min_date_string(*values: str | None) -> str | None:
    candidates = [date.fromisoformat(value) for value in values if value]
    if not candidates:
        return None
    return min(candidates).isoformat()
