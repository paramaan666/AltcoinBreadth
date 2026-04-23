from __future__ import annotations

import logging
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any

import polars as pl

from livealt.binance_client import BinanceClient, UniverseSymbol, last_complete_utc_day
from livealt.bootstrap import bootstrap_from_local_seed
from livealt.breadth import build_metrics_dataset, build_overview, compute_breadth_history, compute_snapshot_tables
from livealt.clustering import build_clusters
from livealt.config import AppConfig, ensure_directories
from livealt.outputs import build_methodology, write_outputs
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
    merge_registry_with_observations,
)
from livealt.validation import validate_output_bundle


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

    symbol_statuses: dict[str, Any] = {}
    client = BinanceClient(config.binance, logger)
    try:
        raw_exchange_info = client.fetch_exchange_info()
        active_symbols = filter_universe_symbols(raw_exchange_info, config.universe)
        logger.info("Discovered %s active symbols in the Binance universe.", len(active_symbols))
        _write_universe_files(config, today_utc, active_symbols)
        for info in active_symbols:
            symbol_statuses[info.symbol] = _update_symbol(client, config, info, data_as_of, logger)
    finally:
        client.close()

    data_inventory = build_data_inventory(config)
    registry = merge_registry_with_observations(
        existing_registry=read_lifecycle_registry(config),
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
    )
    write_outputs(
        config=config,
        overview=overview,
        breadth_history=breadth_history,
        above_rows=above_rows,
        below_rows=below_rows,
        clusters=clusters,
        methodology=methodology,
        validation_report=validation_report,
    )

    summary = {
        "ran_at_utc": datetime.now(tz=UTC).isoformat(),
        "data_as_of": data_as_of.isoformat(),
        "universe_snapshot_date": today_utc.isoformat(),
        "active_universe_count": len(active_symbols),
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
    clusters = read_json(config.paths.outputs_dir / "clusters.json", {})
    methodology = read_json(config.paths.outputs_dir / "methodology.json", {})
    symbol_statuses = read_json(config.paths.manifests_dir / MANIFEST_SYMBOL_STATUS, {})
    report = validate_output_bundle(
        overview=overview,
        breadth_history=breadth_history,
        above_rows=above_rows,
        below_rows=below_rows,
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
