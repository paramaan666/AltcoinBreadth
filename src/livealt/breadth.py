from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

import polars as pl

from livealt.config import AppConfig
from livealt.indicators import compute_symbol_metrics
from livealt.storage import read_symbol_frame
from livealt.universe import is_valid_symbol_name, registry_summary


def build_metrics_dataset(config: AppConfig, registry: dict[str, Any]) -> pl.DataFrame:
    frames: list[pl.DataFrame] = []
    for symbol_dir in sorted(path for path in config.paths.klines_dir.iterdir() if path.is_dir()):
        symbol = symbol_dir.name
        if not is_valid_symbol_name(symbol):
            continue
        frame = read_symbol_frame(config, symbol)
        if frame.is_empty():
            continue
        metrics = compute_symbol_metrics(
            frame=frame,
            ma_days=config.indicators.ma_days,
            atr_days=config.indicators.atr_days,
            momentum_days=config.indicators.momentum_days,
            lifecycle_entry=registry.get(symbol, {}),
        )
        frames.append(metrics)
    if not frames:
        return pl.DataFrame()
    return pl.concat(frames, how="vertical_relaxed").sort(["date", "symbol"])


def compute_breadth_history(metrics: pl.DataFrame) -> list[dict[str, Any]]:
    if metrics.is_empty():
        return []
    eligible = metrics.filter(pl.col("active_on_date") & pl.col("ma_30w").is_not_null())
    if eligible.is_empty():
        return []
    breadth = (
        eligible.group_by("date")
        .agg(
            [
                pl.len().alias("eligible_count"),
                (pl.col("close") > pl.col("ma_30w")).sum().alias("above_count"),
            ]
        )
        .sort("date")
        .with_columns(
            (
                pl.col("above_count") / pl.col("eligible_count") * 100.0
            ).round(4).alias("above_pct")
        )
    )
    rows = breadth.to_dicts()
    for row in rows:
        row["date"] = row["date"].isoformat()
    return rows


def compute_snapshot_tables(metrics: pl.DataFrame) -> tuple[str | None, list[dict[str, Any]], list[dict[str, Any]]]:
    if metrics.is_empty():
        return None, [], []
    eligible = metrics.filter(pl.col("active_on_date") & pl.col("ma_30w").is_not_null())
    if eligible.is_empty():
        return None, [], []
    as_of_date = eligible.get_column("date").max()
    snapshot = eligible.filter(pl.col("date") == pl.lit(as_of_date))
    snapshot = snapshot.select(
        [
            "symbol",
            "date",
            "close",
            "ma_30w",
            "raw_distance_pct",
            "atr_pct_60",
            "normalized_distance",
            "momentum_30d_pct",
            "days_history",
            "listing_date",
            "delisted_date",
        ]
    )
    snapshot_rows = _stringify_snapshot_dates(snapshot.to_dicts())
    above = snapshot.filter(pl.col("close") > pl.col("ma_30w"))
    below = snapshot.filter(pl.col("close") <= pl.col("ma_30w"))
    above_rows = [row for row in snapshot_rows if row["close"] > row["ma_30w"]]
    below_rows = [row for row in snapshot_rows if row["close"] <= row["ma_30w"]]
    return as_of_date.isoformat(), above_rows, below_rows


def build_overview(
    config: AppConfig,
    metrics: pl.DataFrame,
    registry: dict[str, Any],
    breadth_history: list[dict[str, Any]],
    snapshot_date: str | None,
    above_rows: list[dict[str, Any]],
    below_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    summary = registry_summary(registry)
    eligible_count = breadth_history[-1]["eligible_count"] if breadth_history else 0
    above_count = breadth_history[-1]["above_count"] if breadth_history else 0
    above_pct = breadth_history[-1]["above_pct"] if breadth_history else 0.0
    tracked_symbols = len([path for path in config.paths.klines_dir.iterdir() if path.is_dir()]) if config.paths.klines_dir.exists() else 0
    return {
        "as_of_date": snapshot_date,
        "updated_at_utc": datetime.now(tz=UTC).isoformat(),
        "tracked_symbols": tracked_symbols,
        "eligible_symbols": eligible_count,
        "above_count": above_count,
        "above_pct": above_pct,
        "below_count": len(below_rows),
        "active_symbols": summary.get("active", 0),
        "delisted_symbols_total": summary.get("delisted", 0),
        "candidate_delisted_symbols": summary.get("candidate_delisted", 0),
        "universe_rule": "Active Binance USD-M perpetuals quoted in USDT, excluding configured non-coin symbols.",
        "ma_definition": f"{config.indicators.ma_days}-day trailing mean of daily close",
        "distance_definition": f"Raw distance normalized by ATR%({config.indicators.atr_days})",
        "methodology_version": "1.0.0",
        "above_rows": len(above_rows),
        "below_rows": len(below_rows),
    }


def _stringify_snapshot_dates(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    for row in rows:
        if row.get("date") is not None:
            row["date"] = row["date"].isoformat()
        if row.get("listing_date") is not None:
            row["listing_date"] = row["listing_date"].isoformat()
        if row.get("delisted_date") is not None:
            row["delisted_date"] = row["delisted_date"].isoformat()
    return rows
