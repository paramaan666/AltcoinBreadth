from __future__ import annotations

from datetime import date, timedelta

import polars as pl

from livealt.clustering import build_clusters


def test_cluster_output_has_valid_structure(app_config) -> None:
    start = date(2024, 1, 1)
    rows = []
    for offset in range(90):
        current_date = start + timedelta(days=offset)
        rows.extend(
            [
                {
                    "symbol": "AAAUSDT",
                    "date": current_date,
                    "close": 100 + offset,
                    "log_return": 0.01,
                    "active_on_date": True,
                },
                {
                    "symbol": "BBBUSDT",
                    "date": current_date,
                    "close": 200 + offset,
                    "log_return": 0.011,
                    "active_on_date": True,
                },
                {
                    "symbol": "CCCUSDT",
                    "date": current_date,
                    "close": 300 - offset,
                    "log_return": -0.01,
                    "active_on_date": True,
                },
                {
                    "symbol": "DDDUSDT",
                    "date": current_date,
                    "close": 400 - offset,
                    "log_return": -0.011,
                    "active_on_date": True,
                },
            ]
        )
    metrics = pl.DataFrame(rows)

    payload = build_clusters(app_config, metrics, (start + timedelta(days=89)).isoformat())

    assert set(payload) >= {"as_of_date", "params", "clusters", "unassigned_symbols"}
    assert payload["clusters"]
    assert payload["clusters"][0]["size"] >= app_config.clustering.min_cluster_size

