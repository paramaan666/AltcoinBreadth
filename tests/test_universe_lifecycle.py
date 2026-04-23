from __future__ import annotations

from datetime import date

from livealt.binance_client import UniverseSymbol
from livealt.universe import lifecycle_for_date, merge_registry_with_observations


def test_lifecycle_marks_symbol_delisted_after_missing_snapshots() -> None:
    registry = {}
    active = [
        UniverseSymbol(
            symbol="AAAUSDT",
            base_asset="AAA",
            quote_asset="USDT",
            contract_type="PERPETUAL",
            status="TRADING",
            onboard_date=date(2024, 1, 1),
        )
    ]
    registry = merge_registry_with_observations(
        existing_registry=registry,
        snapshot_date=date(2024, 2, 1),
        active_symbols=active,
        data_ranges={"AAAUSDT": {"first_data_date": "2024-01-01", "last_data_date": "2024-02-01"}},
        confirmation_days=2,
    )
    registry = merge_registry_with_observations(
        existing_registry=registry,
        snapshot_date=date(2024, 2, 2),
        active_symbols=[],
        data_ranges={"AAAUSDT": {"first_data_date": "2024-01-01", "last_data_date": "2024-02-01"}},
        confirmation_days=2,
    )
    registry = merge_registry_with_observations(
        existing_registry=registry,
        snapshot_date=date(2024, 2, 3),
        active_symbols=[],
        data_ranges={"AAAUSDT": {"first_data_date": "2024-01-01", "last_data_date": "2024-02-01"}},
        confirmation_days=2,
    )

    entry = registry["AAAUSDT"]
    assert entry["status"] == "delisted"
    assert entry["delisted_date_inferred"] == "2024-02-01"
    assert lifecycle_for_date(entry, date(2024, 2, 1))
    assert not lifecycle_for_date(entry, date(2024, 2, 2))

