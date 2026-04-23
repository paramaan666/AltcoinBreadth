from __future__ import annotations

import shutil
from typing import Any

from livealt.config import AppConfig
from livealt.storage import write_json


def write_outputs(
    config: AppConfig,
    overview: dict[str, Any],
    breadth_history: list[dict[str, Any]],
    above_rows: list[dict[str, Any]],
    below_rows: list[dict[str, Any]],
    clusters: dict[str, Any],
    methodology: dict[str, Any],
    validation_report: dict[str, Any],
) -> None:
    outputs = {
        "overview.json": overview,
        "breadth_history.json": {"series": breadth_history},
        "above_30w_ma.json": {"as_of_date": overview.get("as_of_date"), "rows": above_rows},
        "below_30w_ma.json": {"as_of_date": overview.get("as_of_date"), "rows": below_rows},
        "clusters.json": clusters,
        "methodology.json": methodology,
        "schema_version.json": {"version": "1.0.0"},
    }
    for filename, payload in outputs.items():
        write_json(config.paths.outputs_dir / filename, payload)

    write_json(config.paths.validation_dir / "latest_validation_report.json", validation_report)
    sync_site_data(config)


def sync_site_data(config: AppConfig) -> None:
    config.paths.site_public_data_dir.mkdir(parents=True, exist_ok=True)
    for item in config.paths.site_public_data_dir.glob("*.json"):
        item.unlink()
    for item in sorted(config.paths.outputs_dir.glob("*.json")):
        shutil.copyfile(item, config.paths.site_public_data_dir / item.name)


def build_methodology(config: AppConfig) -> dict[str, Any]:
    return {
        "breadth": {
            "definition": "% of eligible active Binance USDT perpetual symbols trading above their 30-week proxy moving average.",
            "eligible_rule": f"Active on date and at least {config.indicators.ma_days} daily closes available.",
            "ma_proxy": f"{config.indicators.ma_days}-day trailing mean of daily closes.",
        },
        "distance": {
            "raw_distance_pct": "(close / ma_30w - 1) * 100",
            "normalized_distance": f"raw_distance_pct / ATR%({config.indicators.atr_days})",
        },
        "clusters": {
            "returns": "Daily log returns",
            "algorithm": "Agglomerative clustering with average linkage",
            "distance": "sqrt(0.5 * (1 - correlation))",
            "lookback_days": config.clustering.lookback_days,
            "min_cluster_size": config.clustering.min_cluster_size,
        },
        "lifecycle": {
            "listing_rule": "Inferred from earliest available daily bar, first observed active snapshot, and onboard date when available.",
            "delist_rule": "Symbol remains in historical calculations until its inferred delist date and is excluded afterwards.",
            "survivorship_bias": "Historical breadth respects symbol lifecycle intervals instead of today's universe.",
        },
    }

