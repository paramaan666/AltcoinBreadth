from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import polars as pl

from livealt.binance_client import (
    BinanceClient,
    UniverseSymbol,
    is_archive_fallback_error,
    last_complete_utc_day,
)
from livealt.bootstrap import bootstrap_from_local_seed
from livealt.breadth import build_metrics_dataset, build_overview, compute_breadth_history, compute_snapshot_tables
from livealt.clustering import build_clusters
from livealt.config import AppConfig, ensure_directories
from livealt.outputs import build_methodology, write_outputs
from livealt.rotation import build_rotation_history
from livealt.storage import (
    MANIFEST_DATA_INVENTORY,
    MANIFEST_LIFECYCLE_REGISTRY,
    MANIFEST_PIPELINE_STATE,
    MANIFEST_SYMBOL_STATUS,
    append_universe_history,
    build_data_inventory,
    collect_symbol_ranges,
    get_symbol_last_date,
    read_lifecycle_registry,
    upsert_symbol_rows,
    write_manifest,
    write_universe_snapshot,
)
from livealt.universe import (
    build_snapshot_history_frame,
    build_snapshot_payload,
    filter_universe_symbols,
    is_valid_symbol_name,
    merge_registry_with_observations,
)
from livealt.validation import validate_output_bundle


ARCHIVE_DATA_AS_OF_LOOKBACK_DAYS = 7
ARCHIVE_FRESHNESS_PROBES = ("BTCUSDT", "ETHUSDT", "BNBUSDT")


def run_pipeline(
    config: AppConfig,
    logger: logging.Logger,
    bootstrap_source: Path | None = None,
) -> dict[str, Any]:
    ensure_directories(config)
    today_utc = datetime.now(tz=UTC).date()
    data_as_of = last_complete_utc_day()
    bootstrap_summary: dict[str, int] = {}

    if _is_klines_store_empty(config):
        source = bootstrap_source or config.bootstrap.local_seed_path
        if config.bootstrap.auto_seed_on_empty and source:
            bootstrap_summary = bootstrap_from_local_seed(config, source, logger)

    existing_inventory = build_data_inventory(config)
    existing_registry = read_lifecycle_registry(config)
    symbol_statuses: dict[str, Any] = {}
    universe_mode = "rest"
    client = BinanceClient(config.binance, logger)
    try:
        try:
            raw_exchange_info = client.fetch_exchange_info()
            active_symbols = filter_universe_symbols(raw_exchange_info, config.universe)
            discovered_symbols = active_symbols
            logger.info("Discovered %s active symbols in the Binance universe.", len(active_symbols))
        except Exception as exc:  # noqa: BLE001
            if not is_archive_fallback_error(exc):
                raise
            universe_mode = "archive_fallback"
            logger.warning(
                "Binance REST exchangeInfo returned 451. Falling back to Binance archive listing for symbol discovery."
            )
            archive_symbols = client.list_archive_symbols()
            data_as_of = _resolve_archive_data_as_of(
                client=client,
                preferred_date=data_as_of,
                archive_symbols=archive_symbols,
                logger=logger,
            )
            discovered_symbols = _build_archive_discovered_symbols(
                client=client,
                config=config,
                archive_symbols=archive_symbols,
                data_as_of=data_as_of,
                existing_inventory=existing_inventory,
                existing_registry=existing_registry,
                logger=logger,
            )
            active_symbols = []

        for info in discovered_symbols:
            symbol_statuses[info.symbol] = _update_symbol(
                client,
                config,
                info,
                data_as_of,
                logger,
                use_archive_fallback=(universe_mode == "archive_fallback"),
            )
    finally:
        client.close()

    data_inventory = build_data_inventory(config)
    if universe_mode == "archive_fallback":
        active_symbols = _derive_active_symbols_from_inventory(config, data_inventory, data_as_of)
        logger.info(
            "Archive fallback inferred %s active symbols from recent data freshness.",
            len(active_symbols),
        )
    _write_universe_files(config, today_utc, active_symbols)
    registry = merge_registry_with_observations(
        existing_registry=existing_registry,
        snapshot_date=today_utc,
        active_symbols=active_symbols,
        data_ranges=collect_symbol_ranges(config),
        confirmation_days=config.universe.delist_confirmation_days,
    )
    write_manifest(config, MANIFEST_LIFECYCLE_REGISTRY, registry)
    write_manifest(config, MANIFEST_SYMBOL_STATUS, symbol_statuses)
    write_manifest(config, MANIFEST_DATA_INVENTORY, data_inventory)

    metrics = build_metrics_dataset(config, registry)
    breadth_history = compute_breadth_history(metrics)
    snapshot_date, above_rows, below_rows = compute_snapshot_tables(metrics)
    rotation = build_rotation_history(config, metrics, snapshot_date)
    overview = build_overview(
        config=config,
        metrics=metrics,
        registry=registry,
        breadth_history=breadth_history,
        snapshot_date=snapshot_date,
        above_rows=above_rows,
        below_rows=below_rows,
    )
    clusters = build_clusters(config, metrics, snapshot_date)
    methodology = build_methodology(config)
    validation_report = validate_output_bundle(
        overview=overview,
        breadth_history=breadth_history,
        above_rows=above_rows,
        below_rows=below_rows,
        clusters=clusters,
        methodology=methodology,
        min_success_ratio=config.validation.min_success_ratio,
        symbol_statuses=symbol_statuses,
        rotation=rotation,
    )
    write_outputs(
        config=config,
        overview=overview,
        breadth_history=breadth_history,
        above_rows=above_rows,
        below_rows=below_rows,
        rotation=rotation,
        clusters=clusters,
        methodology=methodology,
        validation_report=validation_report,
    )

    summary = {
        "ran_at_utc": datetime.now(tz=UTC).isoformat(),
        "data_as_of": data_as_of.isoformat(),
        "universe_snapshot_date": today_utc.isoformat(),
        "active_universe_count": len(active_symbols),
        "universe_mode": universe_mode,
        "symbol_statuses": symbol_statuses,
        "bootstrap": bootstrap_summary,
        "overview": overview,
        "validation": validation_report,
    }
    write_manifest(config, MANIFEST_PIPELINE_STATE, summary)
    return summary


def validate_existing_outputs(config: AppConfig) -> dict[str, Any]:
    from livealt.storage import read_json

    overview = read_json(config.paths.outputs_dir / "overview.json", {})
    breadth_history = read_json(config.paths.outputs_dir / "breadth_history.json", {}).get("series", [])
    above_rows = read_json(config.paths.outputs_dir / "above_30w_ma.json", {}).get("rows", [])
    below_rows = read_json(config.paths.outputs_dir / "below_30w_ma.json", {}).get("rows", [])
    rotation = read_json(config.paths.outputs_dir / "rotation_history.json", {})
    clusters = read_json(config.paths.outputs_dir / "clusters.json", {})
    methodology = read_json(config.paths.outputs_dir / "methodology.json", {})
    symbol_statuses = read_json(config.paths.manifests_dir / MANIFEST_SYMBOL_STATUS, {})
    report = validate_output_bundle(
        overview=overview,
        breadth_history=breadth_history,
        above_rows=above_rows,
        below_rows=below_rows,
        rotation=rotation,
        clusters=clusters,
        methodology=methodology,
        min_success_ratio=config.validation.min_success_ratio,
        symbol_statuses=symbol_statuses,
    )
    write_outputs(
        config=config,
        overview=overview,
        breadth_history=breadth_history,
        above_rows=above_rows,
        below_rows=below_rows,
        rotation=rotation,
        clusters=clusters,
        methodology=methodology,
        validation_report=report,
    )
    return report


def _is_klines_store_empty(config: AppConfig) -> bool:
    return not any(config.paths.klines_dir.glob("*/*.parquet"))


def _write_universe_files(config: AppConfig, snapshot_date: date, active_symbols: list[Any]) -> None:
    write_universe_snapshot(
        config,
        snapshot_date,
        build_snapshot_payload(snapshot_date, active_symbols),
    )
    history_frame = build_snapshot_history_frame(snapshot_date, active_symbols)
    if not history_frame.is_empty():
        append_universe_history(config, history_frame)


def _update_symbol(
    client: BinanceClient,
    config: AppConfig,
    symbol_info: UniverseSymbol,
    data_as_of: date,
    logger: logging.Logger,
    use_archive_fallback: bool = False,
) -> dict[str, Any]:
    symbol = symbol_info.symbol
    try:
        last_date = get_symbol_last_date(config, symbol)
        start_date = _resolve_start_date(last_date, symbol_info.onboard_date, data_as_of)
        if start_date is None or start_date > data_as_of:
            return {
                "status": "success",
                "last_date": last_date.isoformat() if last_date else None,
                "new_rows": 0,
            }

        logger.info("Updating %s from %s to %s.", symbol, start_date.isoformat(), data_as_of.isoformat())
        if use_archive_fallback:
            frame = client.fetch_archive_daily_klines(
                symbol,
                start_date,
                data_as_of,
                full_backfill=(last_date is None),
            )
        else:
            frame = client.fetch_daily_klines(symbol, start_date, data_as_of)
        if frame.is_empty():
            return {
                "status": "success",
                "last_date": last_date.isoformat() if last_date else None,
                "new_rows": 0,
            }
        upsert_symbol_rows(config, symbol, frame)
        updated_last_date = frame.get_column("date").max()
        return {
            "status": "success",
            "last_date": updated_last_date.isoformat(),
            "new_rows": frame.height,
        }
    except Exception as exc:  # noqa: BLE001
        logger.exception("Failed to update %s.", symbol)
        return {"status": "error", "error": str(exc), "new_rows": 0}


def _resolve_start_date(last_date: date | None, onboard_date: date | None, data_as_of: date) -> date | None:
    if last_date is not None:
        next_date = last_date + timedelta(days=1)
        return next_date if next_date <= data_as_of else None
    if onboard_date is not None:
        return onboard_date
    return date(2019, 9, 1)


def _derive_active_symbols_from_inventory(
    config: AppConfig,
    data_inventory: dict[str, Any],
    data_as_of: date,
) -> list[UniverseSymbol]:
    freshness_cutoff = data_as_of - timedelta(days=config.universe.delist_confirmation_days)
    active: list[UniverseSymbol] = []
    for symbol, ranges in data_inventory.get("symbols", {}).items():
        last_data_date = ranges.get("last_data_date")
        if not last_data_date:
            continue
        if date.fromisoformat(last_data_date) < freshness_cutoff:
            continue
        active.append(
            UniverseSymbol(
                symbol=symbol,
                base_asset=symbol[: -len(config.universe.quote_asset)],
                quote_asset=config.universe.quote_asset,
                contract_type=config.universe.required_contract_type,
                status="INFERRED_ACTIVE",
                onboard_date=None,
            )
        )
    return sorted(active, key=lambda item: item.symbol)


def _resolve_archive_data_as_of(
    client: BinanceClient,
    preferred_date: date,
    archive_symbols: list[str],
    logger: logging.Logger,
) -> date:
    archive_symbol_set = set(archive_symbols)
    probe_symbols = [symbol for symbol in ARCHIVE_FRESHNESS_PROBES if symbol in archive_symbol_set]
    if not probe_symbols:
        probe_symbols = sorted(archive_symbol_set)[:3]

    for days_back in range(ARCHIVE_DATA_AS_OF_LOOKBACK_DAYS + 1):
        candidate = preferred_date - timedelta(days=days_back)
        for symbol in probe_symbols:
            try:
                if client.has_archive_daily_kline(symbol, candidate):
                    if candidate != preferred_date:
                        logger.warning(
                            "Binance archive daily files are not available for %s; using %s as data_as_of.",
                            preferred_date.isoformat(),
                            candidate.isoformat(),
                        )
                    return candidate
            except Exception as exc:  # noqa: BLE001
                logger.warning("Archive freshness probe failed for %s on %s: %s", symbol, candidate, exc)

    logger.warning(
        "Could not confirm Binance archive freshness for %s within %s days; using preferred date.",
        preferred_date.isoformat(),
        ARCHIVE_DATA_AS_OF_LOOKBACK_DAYS,
    )
    return preferred_date


def _build_archive_discovered_symbols(
    client: BinanceClient,
    config: AppConfig,
    archive_symbols: list[str],
    data_as_of: date,
    existing_inventory: dict[str, Any],
    existing_registry: dict[str, Any],
    logger: logging.Logger,
) -> list[UniverseSymbol]:
    freshness_cutoff = data_as_of - timedelta(days=config.universe.delist_confirmation_days)
    known_ranges = existing_inventory.get("symbols", {})
    candidates: list[str] = []
    unknown_symbols: list[str] = []

    for symbol in archive_symbols:
        if symbol in config.universe.exclude_symbols:
            continue
        if not symbol.endswith(config.universe.quote_asset):
            continue
        if not is_valid_symbol_name(symbol):
            continue

        ranges = known_ranges.get(symbol)
        if ranges is None:
            unknown_symbols.append(symbol)
            continue

        last_data_date_raw = ranges.get("last_data_date")
        last_data_date = date.fromisoformat(last_data_date_raw) if last_data_date_raw else None
        status = existing_registry.get(symbol, {}).get("status")
        should_refresh = (
            last_data_date is None
            or last_data_date >= freshness_cutoff
            or status in {"active", "candidate_delisted", "unknown", None}
        )
        if should_refresh:
            candidates.append(symbol)

    logger.info(
        "Archive fallback selected %s known symbols for refresh and will probe %s unknown symbols for new listings.",
        len(candidates),
        len(unknown_symbols),
    )

    for symbol in unknown_symbols:
        try:
            if client.has_archive_daily_kline(symbol, data_as_of):
                candidates.append(symbol)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Archive probe failed for %s: %s", symbol, exc)

    return [
        UniverseSymbol(
            symbol=symbol,
            base_asset=symbol[: -len(config.universe.quote_asset)],
            quote_asset=config.universe.quote_asset,
            contract_type=config.universe.required_contract_type,
            status="ARCHIVE_DISCOVERED",
            onboard_date=None,
        )
        for symbol in sorted(set(candidates))
    ]
