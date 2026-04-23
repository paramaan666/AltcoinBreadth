from __future__ import annotations

from datetime import date
import logging

from livealt.daily_update import _build_archive_discovered_symbols, _update_symbol
from livealt.binance_client import UniverseSymbol
from livealt.storage import read_symbol_frame
from tests.conftest import make_daily_rows


class MixedClient:
    def fetch_daily_klines(self, symbol, start_date, end_date):
        if symbol == "BADUSDT":
            raise RuntimeError("boom")
        return make_daily_rows(symbol, start_date, [100.0, 101.0])


def test_single_symbol_failure_does_not_break_other_symbols(app_config) -> None:
    client = MixedClient()
    good = UniverseSymbol("GOODUSDT", "GOOD", "USDT", "PERPETUAL", "TRADING", date(2024, 1, 1))
    bad = UniverseSymbol("BADUSDT", "BAD", "USDT", "PERPETUAL", "TRADING", date(2024, 1, 1))

    good_result = _update_symbol(client, app_config, good, date(2024, 1, 2), logging.getLogger("test"))
    bad_result = _update_symbol(client, app_config, bad, date(2024, 1, 2), logging.getLogger("test"))

    assert good_result["status"] == "success"
    assert bad_result["status"] == "error"
    assert read_symbol_frame(app_config, "GOODUSDT").height == 2


class ArchiveProbeClient:
    def has_archive_daily_kline(self, symbol, on_date):
        return symbol == "NEWUSDT"


def test_archive_fallback_skips_stale_delisted_symbols(app_config) -> None:
    client = ArchiveProbeClient()
    discovered = _build_archive_discovered_symbols(
        client=client,
        config=app_config,
        archive_symbols=["ACTIVEUSDT", "OLDUSDT", "NEWUSDT", "BAD-SYMBOL"],
        data_as_of=date(2024, 2, 10),
        existing_inventory={
            "symbols": {
                "ACTIVEUSDT": {"last_data_date": "2024-02-10"},
                "OLDUSDT": {"last_data_date": "2023-12-15"},
            }
        },
        existing_registry={
            "ACTIVEUSDT": {"status": "active"},
            "OLDUSDT": {"status": "delisted"},
        },
        logger=logging.getLogger("test"),
    )

    assert [item.symbol for item in discovered] == ["ACTIVEUSDT", "NEWUSDT"]
