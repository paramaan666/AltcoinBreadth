from __future__ import annotations

from livealt.validation import validate_output_bundle


def test_json_outputs_pass_schema_validation() -> None:
    report = validate_output_bundle(
        overview={
            "as_of_date": "2024-09-01",
            "updated_at_utc": "2024-09-02T00:00:00Z",
            "tracked_symbols": 10,
            "eligible_symbols": 8,
            "above_count": 4,
            "above_pct": 50.0,
            "below_count": 4,
        },
        breadth_history=[
            {"date": "2024-09-01", "eligible_count": 8, "above_count": 4, "above_pct": 50.0},
        ],
        above_rows=[
            {
                "symbol": "AAAUSDT",
                "close": 1.0,
                "ma_30w": 0.8,
                "raw_distance_pct": 25.0,
                "atr_pct_60": 8.0,
                "normalized_distance": 3.125,
                "momentum_30d_pct": 12.0,
                "days_history": 250,
            }
        ],
        below_rows=[
            {
                "symbol": "BBBUSDT",
                "close": 0.8,
                "ma_30w": 1.0,
                "raw_distance_pct": -20.0,
                "atr_pct_60": 10.0,
                "normalized_distance": -2.0,
                "momentum_30d_pct": -8.0,
                "days_history": 250,
            }
        ],
        rotation={
            "as_of_date": "2024-09-01",
            "trail_days": 7,
            "lookbacks": [1, 3, 7],
            "summary": {
                "symbol_count": 1,
                "trend_counts": {"improving": 1, "deteriorating": 0, "mixed": 0, "flat": 0},
                "quadrant_counts": {"above_momentum": 1, "above_fading": 0, "below_rebound": 0, "below_weak": 0},
                "median_momentum_30d_pct": 12.0,
                "median_normalized_distance": 3.125,
            },
            "rows": [
                {
                    "symbol": "AAAUSDT",
                    "quadrant": "above_momentum",
                    "trend_direction": "improving",
                    "current": {
                        "date": "2024-09-01",
                        "close": 1.0,
                        "ma_30w": 0.8,
                        "momentum_30d_pct": 12.0,
                        "raw_distance_pct": 25.0,
                        "normalized_distance": 3.125,
                    },
                    "deltas": {},
                    "trail": [
                        {
                            "date": "2024-09-01",
                            "close": 1.0,
                            "ma_30w": 0.8,
                            "momentum_30d_pct": 12.0,
                            "raw_distance_pct": 25.0,
                            "normalized_distance": 3.125,
                        }
                    ],
                }
            ],
        },
        clusters={
            "as_of_date": "2024-09-01",
            "params": {"algorithm": "agglomerative", "return_mode": "residual"},
            "clusters": [{"cluster_id": 1, "label": "Cluster 1", "size": 5, "symbols": ["AAAUSDT"]}],
            "unassigned_symbols": [],
            "embedding": [],
        },
        methodology={
            "breadth": {"definition": "x"},
            "distance": {"definition": "x"},
            "rotation": {"definition": "x"},
            "clusters": {"definition": "x"},
            "lifecycle": {"definition": "x"},
        },
        min_success_ratio=0.5,
        symbol_statuses={"AAAUSDT": {"status": "success"}, "BBBUSDT": {"status": "error"}},
    )

    assert report["passed"] is True
