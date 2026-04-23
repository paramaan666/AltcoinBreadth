from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

import polars as pl

from livealt.config import AppConfig


MANIFEST_PIPELINE_STATE = "pipeline_state.json"
MANIFEST_SYMBOL_STATUS = "symbol_status.json"
MANIFEST_DATA_INVENTORY = "data_inventory.json"
MANIFEST_LIFECYCLE_REGISTRY = "lifecycle_registry.json"
UNIVERSE_LATEST = "latest.json"
UNIVERSE_HISTORY = "history.parquet"


def _json_default(value: Any) -> Any:
    if isinstance(value, (date, Path)):
        return str(value)
    raise TypeError(f"Object of type {type(value)!r} is not JSON serializable.")


def read_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(data, handle, indent=2, sort_keys=True, default=_json_default)
        handle.write("\n")


def read_manifest(config: AppConfig, name: str, default: Any) -> Any:
    return read_json(config.paths.manifests_dir / name, default)


def write_manifest(config: AppConfig, name: str, data: Any) -> None:
    write_json(config.paths.manifests_dir / name, data)


def symbol_dir(config: AppConfig, symbol: str) -> Path:
    return config.paths.klines_dir / symbol


def symbol_year_path(config: AppConfig, symbol: str, year: int) -> Path:
    return symbol_dir(config, symbol) / f"{year}.parquet"


def read_symbol_year(config: AppConfig, symbol: str, year: int) -> pl.DataFrame:
    path = symbol_year_path(config, symbol, year)
    if not path.exists():
        return pl.DataFrame()
    return pl.read_parquet(path)


def list_symbol_years(config: AppConfig, symbol: str) -> list[int]:
    directory = symbol_dir(config, symbol)
    if not directory.exists():
        return []
    years: list[int] = []
    for item in directory.glob("*.parquet"):
        try:
            years.append(int(item.stem))
        except ValueError:
            continue
    return sorted(years)


def symbol_exists(config: AppConfig, symbol: str) -> bool:
    return symbol_dir(config, symbol).exists()


def read_symbol_frame(config: AppConfig, symbol: str) -> pl.DataFrame:
    years = list_symbol_years(config, symbol)
    if not years:
        return pl.DataFrame()
    return pl.concat(
        [read_symbol_year(config, symbol, year) for year in years],
        how="vertical_relaxed",
    ).sort("date")


def get_symbol_last_date(config: AppConfig, symbol: str) -> date | None:
    years = list_symbol_years(config, symbol)
    if not years:
        return None
    frame = read_symbol_year(config, symbol, years[-1])
    if frame.is_empty():
        return None
    return frame.get_column("date").max()


def get_symbol_first_date(config: AppConfig, symbol: str) -> date | None:
    years = list_symbol_years(config, symbol)
    if not years:
        return None
    frame = read_symbol_year(config, symbol, years[0])
    if frame.is_empty():
        return None
    return frame.get_column("date").min()


def upsert_symbol_rows(config: AppConfig, symbol: str, rows: pl.DataFrame) -> dict[str, int]:
    if rows.is_empty():
        return {}
    rows = rows.with_columns(pl.col("date").cast(pl.Date)).sort("date")
    years = rows.get_column("date").dt.year().unique().sort().to_list()
    stats: dict[str, int] = {}
    directory = symbol_dir(config, symbol)
    directory.mkdir(parents=True, exist_ok=True)
    for year in years:
        year_rows = rows.filter(pl.col("date").dt.year() == year)
        existing = read_symbol_year(config, symbol, year)
        if existing.is_empty():
            merged = year_rows.sort("date")
        else:
            merged = (
                pl.concat([existing, year_rows], how="vertical_relaxed")
                .unique(subset=["date"], keep="last")
                .sort("date")
            )
        merged.write_parquet(symbol_year_path(config, symbol, year), compression="zstd")
        stats[str(year)] = merged.height
    return stats


def write_universe_snapshot(config: AppConfig, snapshot_date: date, payload: dict[str, Any]) -> None:
    path = config.paths.universe_dir / "snapshots" / f"{snapshot_date.isoformat()}.json"
    write_json(path, payload)
    write_json(config.paths.universe_dir / UNIVERSE_LATEST, payload)


def append_universe_history(config: AppConfig, frame: pl.DataFrame) -> None:
    path = config.paths.universe_dir / UNIVERSE_HISTORY
    if path.exists():
        existing = pl.read_parquet(path)
        frame = pl.concat([existing, frame], how="vertical_relaxed")
    frame = frame.unique(subset=["snapshot_date", "symbol"], keep="last").sort(
        ["snapshot_date", "symbol"]
    )
    frame.write_parquet(path, compression="zstd")


def read_lifecycle_registry(config: AppConfig) -> dict[str, Any]:
    return read_manifest(config, MANIFEST_LIFECYCLE_REGISTRY, {})


def read_pipeline_state(config: AppConfig) -> dict[str, Any]:
    return read_manifest(config, MANIFEST_PIPELINE_STATE, {})


def collect_symbol_ranges(config: AppConfig) -> dict[str, dict[str, str | None]]:
    if not config.paths.klines_dir.exists():
        return {}
    ranges: dict[str, dict[str, str | None]] = {}
    for directory in sorted(path for path in config.paths.klines_dir.iterdir() if path.is_dir()):
        symbol = directory.name
        first_date = get_symbol_first_date(config, symbol)
        last_date = get_symbol_last_date(config, symbol)
        ranges[symbol] = {
            "first_data_date": first_date.isoformat() if first_date else None,
            "last_data_date": last_date.isoformat() if last_date else None,
        }
    return ranges


def build_data_inventory(config: AppConfig) -> dict[str, Any]:
    symbol_ranges = collect_symbol_ranges(config)
    symbol_count = len(symbol_ranges)
    total_year_files = 0
    for directory in sorted(path for path in config.paths.klines_dir.iterdir() if path.is_dir()):
        total_year_files += len(list(directory.glob("*.parquet")))
    return {
        "symbol_count": symbol_count,
        "year_shard_count": total_year_files,
        "symbols": symbol_ranges,
    }
