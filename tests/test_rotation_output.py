from __future__ import annotations

from datetime import date, timedelta

import polars as pl

from livealt.rotation import build_rotation_history


def test_rotation_history_has_expected_structure(app_config) -> None:
    start = date(2024, 1, 1)
    rows = []
    for offset in range(12):
        current_date = start + timedelta(days=offset)
        rows.append(
            {
                "symbol": "AAAUSDT",
                "date": current_date,
                "close": 100 + offset,
                "ma_30w": 90,
                "raw_distance_pct": 10 + offset,
                "normalized_distance": 1 + offset / 10,
                "momentum_30d_pct": 5 + offset,
                "active_on_date": True,
            }
        )
    metrics = pl.DataFrame(rows)
    payload = build_rotation_history(app_config, metrics, (start + timedelta(days=11)).isoformat())

    assert set(payload) >= {"as_of_date", "trail_days", "lookbacks", "summary", "rows"}
    assert len(payload["rows"]) == 1
    row = payload["rows"][0]
    assert row["symbol"] == "AAAUSDT"
    assert row["trend_direction"] == "improving"
    assert len(row["trail"]) == app_config.rotation.trail_days
    assert row["deltas"]["7d"]["momentum_change"] == 7
