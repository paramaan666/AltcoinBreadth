from __future__ import annotations

from datetime import date
import logging

from livealt.binance_client import UniverseSymbol
from livealt.daily_update import _update_symbol
from livealt.storage import read_symbol_frame, upsert_symbol_rows
from tests.conftest import make_daily_rows


class FakeClient:
    def __init__(self) -> None:
        self.calls: list[tuple[str, date, date]] = []

    def fetch_daily_klines(self, symbol: str, start_date: date, end_date: date):
        self.calls.append((symbol, start_date, end_date))
        return make_daily_rows(symbol, start_date, [103.0, 104.0])


def test_incremental_update_fetches_only_missing_days(app_config) -> None:
    upsert_symbol_rows(app_config, "AAAUSDT", make_daily_rows("AAAUSDT", date(2024, 1, 1), [100.0, 101.0, 102.0]))
    client = FakeClient()
    info = UniverseSymbol(
        symbol="AAAUSDT",
        base_asset="AAA",
        quote_asset="USDT",
        contract_type="PERPETUAL",
        status="TRADING",
        onboard_date=date(2024, 1, 1),
    )

    result = _update_symbol(client, app_config, info, date(2024, 1, 5), logging.getLogger("test"))

    assert client.calls == [("AAAUSDT", date(2024, 1, 4), date(2024, 1, 5))]
    assert result["new_rows"] == 2
    frame = read_symbol_frame(app_config, "AAAUSDT")
    assert frame.height == 5
    assert frame.get_column("date").to_list()[-1] == date(2024, 1, 5)

