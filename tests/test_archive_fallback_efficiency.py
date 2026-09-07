from __future__ import annotations

from datetime import date

import polars as pl

from livealt.binance_client import BinanceClient
from tests.conftest import make_daily_rows


class FakeArchiveClient:
    fetch_archive_daily_klines = BinanceClient.fetch_archive_daily_klines

    def __init__(self, monthly_frame: pl.DataFrame | None = None) -> None:
        self.monthly_frame = monthly_frame if monthly_frame is not None else pl.DataFrame()
        self.calls: list[str] = []

    def _download_archive_frame(
        self,
        archive_key: str,
        symbol: str,
        allow_missing: bool = False,
    ) -> pl.DataFrame:
        del symbol, allow_missing
        self.calls.append(archive_key)
        if "/monthly/" in archive_key:
            return self.monthly_frame
        return pl.DataFrame()


def test_completed_partial_month_uses_single_monthly_archive() -> None:
    monthly_frame = make_daily_rows("AAAUSDT", date(2024, 1, 1), [100.0] * 31)
    client = FakeArchiveClient(monthly_frame)

    frame = client.fetch_archive_daily_klines(
        "AAAUSDT",
        date(2024, 1, 15),
        date(2024, 1, 20),
    )

    assert client.calls == [
        "data/futures/um/monthly/klines/AAAUSDT/1d/AAAUSDT-1d-2024-01.zip"
    ]
    assert frame.get_column("date").to_list() == [
        date(2024, 1, 15),
        date(2024, 1, 16),
        date(2024, 1, 17),
        date(2024, 1, 18),
        date(2024, 1, 19),
        date(2024, 1, 20),
    ]


def test_full_archive_backfill_is_bounded_to_one_year() -> None:
    client = FakeArchiveClient()

    frame = client.fetch_archive_daily_klines(
        "NEWUSDT",
        date(2019, 9, 1),
        date(2024, 12, 31),
        full_backfill=True,
    )

    assert frame.is_empty()
    assert len(client.calls) == 12
    assert client.calls[0].endswith("NEWUSDT-1d-2024-01.zip")
    assert client.calls[-1].endswith("NEWUSDT-1d-2024-12.zip")
    assert all("/monthly/" in call for call in client.calls)
