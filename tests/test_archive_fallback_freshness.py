from __future__ import annotations

import logging
from datetime import date

from livealt.daily_update import _resolve_archive_data_as_of


class FakeArchiveClient:
    def __init__(self, available_dates: set[date]) -> None:
        self.available_dates = available_dates

    def has_archive_daily_kline(self, symbol: str, on_date: date) -> bool:
        return symbol == "BTCUSDT" and on_date in self.available_dates


def test_archive_data_as_of_falls_back_to_latest_available_day() -> None:
    client = FakeArchiveClient({date(2026, 4, 26)})

    data_as_of = _resolve_archive_data_as_of(
        client=client,
        preferred_date=date(2026, 4, 27),
        archive_symbols=["BTCUSDT", "ETHUSDT"],
        logger=logging.getLogger("test"),
    )

    assert data_as_of == date(2026, 4, 26)
