from __future__ import annotations

from datetime import date

from livealt.breadth import build_metrics_dataset, compute_snapshot_tables
from livealt.storage import upsert_symbol_rows
from tests.conftest import make_daily_rows


def test_snapshot_rows_include_expected_fields(app_config) -> None:
    rising = [100.0 + (index * 0.5) for index in range(220)]
    falling = [100.0 - (index * 0.3) for index in range(220)]
    upsert_symbol_rows(app_config, "AAAUSDT", make_daily_rows("AAAUSDT", date(2023, 1, 1), rising))
    upsert_symbol_rows(app_config, "BBBUSDT", make_daily_rows("BBBUSDT", date(2023, 1, 1), falling))
    registry = {
        "AAAUSDT": {"listing_date_inferred": "2023-01-01", "delisted_date_inferred": None},
        "BBBUSDT": {"listing_date_inferred": "2023-01-01", "delisted_date_inferred": None},
    }

    metrics = build_metrics_dataset(app_config, registry)
    _, above, below = compute_snapshot_tables(metrics)

    assert above
    assert below
    for row in [above[0], below[0]]:
        assert {"symbol", "close", "ma_30w", "raw_distance_pct", "normalized_distance"} <= set(row)

