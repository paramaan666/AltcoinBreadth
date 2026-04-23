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
                "days_history": 250,
            }
        ],
        clusters={
            "as_of_date": "2024-09-01",
            "params": {"algorithm": "agglomerative"},
            "clusters": [{"cluster_id": 1, "label": "Cluster 1", "size": 5, "symbols": ["AAAUSDT"]}],
            "unassigned_symbols": [],
        },
        methodology={
            "breadth": {"definition": "x"},
            "distance": {"definition": "x"},
            "clusters": {"definition": "x"},
            "lifecycle": {"definition": "x"},
        },
        min_success_ratio=0.5,
        symbol_statuses={"AAAUSDT": {"status": "success"}, "BBBUSDT": {"status": "error"}},
    )

    assert report["passed"] is True
