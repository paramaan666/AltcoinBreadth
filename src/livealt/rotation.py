from __future__ import annotations

from datetime import date, timedelta
from statistics import median
from typing import Any

import polars as pl

from livealt.config import AppConfig


def build_rotation_history(config: AppConfig, metrics: pl.DataFrame, as_of_date: str | None) -> dict[str, Any]:
    if metrics.is_empty() or as_of_date is None:
        return _empty_payload(config, as_of_date)

    as_of = date.fromisoformat(as_of_date)
    current = _current_snapshot(metrics, as_of)
    if current.is_empty():
        return _empty_payload(config, as_of_date)

    current_symbols = current.get_column("symbol").to_list()
    start_date = as_of - timedelta(days=max(config.rotation.trail_days + max(config.rotation.lookbacks, default=0), 1) + 2)
    history = (
        metrics.filter(
            pl.col("symbol").is_in(current_symbols)
            & pl.col("active_on_date")
            & pl.col("ma_30w").is_not_null()
            & (pl.col("date") >= pl.lit(start_date))
            & (pl.col("date") <= pl.lit(as_of))
        )
        .select(
            [
                "symbol",
                "date",
                "close",
                "ma_30w",
                "raw_distance_pct",
                "normalized_distance",
                "momentum_30d_pct",
            ]
        )
        .sort(["symbol", "date"])
    )
    grouped = {symbol: rows for symbol, rows in history.group_by("symbol", maintain_order=True)}
    rows = [_build_symbol_rotation(symbol, symbol_history, config, as_of) for symbol, symbol_history in grouped.items()]
    rows = [row for row in rows if row is not None]
    rows.sort(key=lambda row: row["symbol"])

    return {
        "as_of_date": as_of_date,
        "trail_days": config.rotation.trail_days,
        "lookbacks": config.rotation.lookbacks,
        "summary": _rotation_summary(rows),
        "rows": rows,
    }


def _empty_payload(config: AppConfig, as_of_date: str | None) -> dict[str, Any]:
    return {
        "as_of_date": as_of_date,
        "trail_days": config.rotation.trail_days,
        "lookbacks": config.rotation.lookbacks,
        "summary": _rotation_summary([]),
        "rows": [],
    }


def _current_snapshot(metrics: pl.DataFrame, as_of: date) -> pl.DataFrame:
    return metrics.filter(
        (pl.col("date") == pl.lit(as_of))
        & pl.col("active_on_date")
        & pl.col("ma_30w").is_not_null()
        & pl.col("momentum_30d_pct").is_not_null()
        & pl.col("raw_distance_pct").is_not_null()
    )


def _build_symbol_rotation(
    symbol_key: tuple[str],
    symbol_history: pl.DataFrame,
    config: AppConfig,
    as_of: date,
) -> dict[str, Any] | None:
    symbol = symbol_key[0]
    daily_rows = [_format_point(row) for row in symbol_history.to_dicts()]
    if not daily_rows:
        return None
    current = daily_rows[-1]
    if current["date"] != as_of.isoformat():
        return None

    trail = daily_rows[-config.rotation.trail_days :]
    deltas = {
        f"{lookback}d": _delta_for_lookback(daily_rows, current, lookback)
        for lookback in config.rotation.lookbacks
    }
    trend = _trend_direction(deltas)
    quadrant = _quadrant(current["momentum_30d_pct"], current["normalized_distance"] or current["raw_distance_pct"])
    return {
        "symbol": symbol,
        "quadrant": quadrant,
        "trend_direction": trend,
        "current": current,
        "deltas": deltas,
        "trail": trail,
    }


def _format_point(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "date": row["date"].isoformat(),
        "close": round(float(row["close"]), 10),
        "ma_30w": round(float(row["ma_30w"]), 10),
        "momentum_30d_pct": round(float(row["momentum_30d_pct"]), 6),
        "raw_distance_pct": round(float(row["raw_distance_pct"]), 6),
        "normalized_distance": round(float(row["normalized_distance"]), 6) if row.get("normalized_distance") is not None else None,
    }


def _delta_for_lookback(rows: list[dict[str, Any]], current: dict[str, Any], lookback: int) -> dict[str, Any]:
    if len(rows) <= lookback:
        return {
            "from_date": None,
            "momentum_change": None,
            "raw_distance_change": None,
            "normalized_distance_change": None,
        }
    previous = rows[-lookback - 1]
    normalized_change = None
    if current["normalized_distance"] is not None and previous["normalized_distance"] is not None:
        normalized_change = round(current["normalized_distance"] - previous["normalized_distance"], 6)
    return {
        "from_date": previous["date"],
        "momentum_change": round(current["momentum_30d_pct"] - previous["momentum_30d_pct"], 6),
        "raw_distance_change": round(current["raw_distance_pct"] - previous["raw_distance_pct"], 6),
        "normalized_distance_change": normalized_change,
    }


def _trend_direction(deltas: dict[str, dict[str, Any]]) -> str:
    for key in ("7d", "3d", "1d"):
        delta = deltas.get(key)
        if not delta or delta.get("momentum_change") is None:
            continue
        momentum = float(delta["momentum_change"])
        distance = delta.get("normalized_distance_change")
        if distance is None:
            distance = delta.get("raw_distance_change")
        if distance is None:
            continue
        distance = float(distance)
        momentum_flat = abs(momentum) < 0.5
        distance_flat = abs(distance) < 0.1
        if momentum_flat and distance_flat:
            return "flat"
        if momentum > 0 and distance > 0:
            return "improving"
        if momentum < 0 and distance < 0:
            return "deteriorating"
        return "mixed"
    return "flat"


def _quadrant(momentum: float, distance: float) -> str:
    if momentum >= 0 and distance >= 0:
        return "above_momentum"
    if momentum < 0 and distance >= 0:
        return "above_fading"
    if momentum >= 0 and distance < 0:
        return "below_rebound"
    return "below_weak"


def _rotation_summary(rows: list[dict[str, Any]]) -> dict[str, Any]:
    trend_counts = {"improving": 0, "deteriorating": 0, "mixed": 0, "flat": 0}
    quadrant_counts = {"above_momentum": 0, "above_fading": 0, "below_rebound": 0, "below_weak": 0}
    momentums: list[float] = []
    distances: list[float] = []
    for row in rows:
        trend_counts[row["trend_direction"]] += 1
        quadrant_counts[row["quadrant"]] += 1
        current = row["current"]
        momentums.append(float(current["momentum_30d_pct"]))
        if current["normalized_distance"] is not None:
            distances.append(float(current["normalized_distance"]))

    return {
        "symbol_count": len(rows),
        "trend_counts": trend_counts,
        "quadrant_counts": quadrant_counts,
        "median_momentum_30d_pct": round(median(momentums), 6) if momentums else None,
        "median_normalized_distance": round(median(distances), 6) if distances else None,
    }
