from __future__ import annotations

from datetime import date
from typing import Any

import polars as pl


def compute_symbol_metrics(
    frame: pl.DataFrame,
    ma_days: int,
    atr_days: int,
    lifecycle_entry: dict[str, Any] | None,
) -> pl.DataFrame:
    if frame.is_empty():
        return frame

    listing_date = _parse_iso_date(lifecycle_entry.get("listing_date_inferred")) if lifecycle_entry else None
    delisted_date = _parse_iso_date(lifecycle_entry.get("delisted_date_inferred")) if lifecycle_entry else None

    active_expr = pl.lit(True)
    if listing_date is not None:
        active_expr = active_expr & (pl.col("date") >= pl.lit(listing_date))
    if delisted_date is not None:
        active_expr = active_expr & (pl.col("date") <= pl.lit(delisted_date))

    return (
        frame.sort("date")
        .with_row_index("row_nr")
        .with_columns(
            [
                (pl.col("close").log() - pl.col("close").shift(1).log()).alias("log_return"),
                pl.col("close").rolling_mean(window_size=ma_days, min_samples=ma_days).alias("ma_30w"),
                pl.col("close").shift(1).alias("prev_close"),
                (pl.col("row_nr") + 1).alias("days_history"),
                active_expr.alias("active_on_date"),
                pl.lit(listing_date).alias("listing_date"),
                pl.lit(delisted_date).alias("delisted_date"),
            ]
        )
        .with_columns(
            [
                pl.max_horizontal(
                    [
                        pl.col("high") - pl.col("low"),
                        (pl.col("high") - pl.col("prev_close")).abs(),
                        (pl.col("low") - pl.col("prev_close")).abs(),
                    ]
                ).alias("true_range"),
            ]
        )
        .with_columns(
            [
                pl.col("true_range").rolling_mean(window_size=atr_days, min_samples=atr_days).alias("atr_60"),
            ]
        )
        .with_columns(
            [
                ((pl.col("close") / pl.col("ma_30w")) - 1.0).mul(100).alias("raw_distance_pct"),
                (pl.col("atr_60") / pl.col("close")).mul(100).alias("atr_pct_60"),
            ]
        )
        .with_columns(
            pl.when(pl.col("atr_pct_60") > 0)
            .then(pl.col("raw_distance_pct") / pl.col("atr_pct_60"))
            .otherwise(None)
            .alias("normalized_distance")
        )
        .drop("row_nr")
    )


def _parse_iso_date(value: str | None) -> date | None:
    if not value:
        return None
    return date.fromisoformat(value)

