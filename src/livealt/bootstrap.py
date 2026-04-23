from __future__ import annotations

import logging
from pathlib import Path
from typing import Iterable

import polars as pl

from livealt.config import AppConfig
from livealt.storage import symbol_exists, upsert_symbol_rows
from livealt.universe import is_valid_symbol_name


def bootstrap_from_local_seed(
    config: AppConfig,
    source_root: Path,
    logger: logging.Logger,
    symbols: Iterable[str] | None = None,
) -> dict[str, int]:
    if not source_root.exists():
        logger.info("Local bootstrap seed path %s does not exist. Skipping.", source_root)
        return {"bootstrapped_symbols": 0, "skipped_existing_symbols": 0}

    requested = set(symbols or [])
    bootstrapped = 0
    skipped = 0
    failed = 0

    for symbol_dir in sorted(path for path in source_root.iterdir() if path.is_dir()):
        symbol = symbol_dir.name
        if requested and symbol not in requested:
            continue
        if not symbol.endswith(config.universe.quote_asset):
            continue
        if not is_valid_symbol_name(symbol):
            continue
        if symbol in config.universe.exclude_symbols:
            continue
        file_path = symbol_dir / f"{symbol}_1m.parquet"
        if not file_path.exists():
            continue
        if symbol_exists(config, symbol):
            skipped += 1
            continue

        logger.info("Bootstrapping %s from local parquet seed.", symbol)
        try:
            daily = _aggregate_1m_to_daily(file_path, symbol)
        except Exception as exc:  # noqa: BLE001
            logger.exception("Failed to bootstrap %s from %s: %s", symbol, file_path, exc)
            failed += 1
            continue
        if daily.is_empty():
            continue
        upsert_symbol_rows(config, symbol, daily)
        bootstrapped += 1

    return {
        "bootstrapped_symbols": bootstrapped,
        "skipped_existing_symbols": skipped,
        "failed_symbols": failed,
    }


def _aggregate_1m_to_daily(file_path: Path, symbol: str) -> pl.DataFrame:
    frame = (
        pl.scan_parquet(file_path)
        .select(
            [
                pl.col("timestamp"),
                pl.col("open"),
                pl.col("high"),
                pl.col("low"),
                pl.col("close"),
                pl.col("volume"),
                pl.col("quote_volume"),
                pl.col("trade_count"),
                pl.col("taker_buy_volume"),
                pl.col("taker_buy_quote_volume"),
            ]
        )
        .with_columns(pl.col("timestamp").dt.date().alias("date"))
        .group_by("date")
        .agg(
            [
                pl.col("timestamp").dt.epoch("ms").min().alias("open_time_ms"),
                pl.col("timestamp").dt.epoch("ms").max().alias("close_time_ms"),
                pl.col("open").first().alias("open"),
                pl.col("high").max().alias("high"),
                pl.col("low").min().alias("low"),
                pl.col("close").last().alias("close"),
                pl.col("volume").sum().alias("volume"),
                pl.col("quote_volume").sum().alias("quote_volume"),
                pl.col("trade_count").sum().alias("trade_count"),
                pl.col("taker_buy_volume").sum().alias("taker_buy_volume"),
                pl.col("taker_buy_quote_volume").sum().alias("taker_buy_quote_volume"),
            ]
        )
        .sort("date")
        .collect()
    )
    return frame.with_columns(pl.lit(symbol).alias("symbol")).select(
        [
            "symbol",
            "date",
            "open_time_ms",
            "close_time_ms",
            "open",
            "high",
            "low",
            "close",
            "volume",
            "quote_volume",
            "trade_count",
            "taker_buy_volume",
            "taker_buy_quote_volume",
        ]
    )
