from __future__ import annotations

from datetime import date, timedelta
from pathlib import Path

import polars as pl
import pytest

from livealt.config import (
    AppConfig,
    BinanceConfig,
    BootstrapConfig,
    ClusteringConfig,
    IndicatorsConfig,
    PathsConfig,
    UniverseConfig,
    ValidationConfig,
    ensure_directories,
)


@pytest.fixture()
def app_config(tmp_path: Path) -> AppConfig:
    config = AppConfig(
        repo_root=tmp_path,
        paths=PathsConfig(
            data_dir=tmp_path / "data",
            universe_dir=tmp_path / "data" / "universe",
            klines_dir=tmp_path / "data" / "klines_1d",
            manifests_dir=tmp_path / "data" / "manifests",
            logs_dir=tmp_path / "data" / "logs",
            outputs_dir=tmp_path / "outputs" / "api",
            validation_dir=tmp_path / "outputs" / "validation",
            site_public_data_dir=tmp_path / "site" / "public" / "data",
        ),
        binance=BinanceConfig(
            base_url="https://example.com",
            exchange_info_path="/exchangeInfo",
            klines_path="/klines",
            archive_base_url="https://data.binance.vision",
            archive_bucket_listing_url="https://s3-ap-northeast-1.amazonaws.com/data.binance.vision",
            request_timeout_seconds=5,
            max_retries=2,
            retry_backoff_seconds=0.01,
            max_backoff_seconds=0.02,
            kline_limit=1500,
            klines_interval="1d",
        ),
        universe=UniverseConfig(
            quote_asset="USDT",
            required_contract_type="PERPETUAL",
            required_status="TRADING",
            delist_confirmation_days=2,
            exclude_symbols=["BTCDOMUSDT"],
        ),
        indicators=IndicatorsConfig(ma_days=210, atr_days=60, momentum_days=30, min_days_for_cluster=60),
        clustering=ClusteringConfig(
            lookback_days=60,
            distance_threshold=0.8,
            min_cluster_size=2,
            embed_2d=True,
            max_symbols_for_embedding=50,
            random_state=7,
        ),
        bootstrap=BootstrapConfig(auto_seed_on_empty=False, local_seed_path=None),
        validation=ValidationConfig(min_success_ratio=0.5),
    )
    ensure_directories(config)
    return config


def make_daily_rows(symbol: str, start: date, closes: list[float]) -> pl.DataFrame:
    rows = []
    for offset, close in enumerate(closes):
        current_date = start + timedelta(days=offset)
        rows.append(
            {
                "symbol": symbol,
                "date": current_date,
                "open_time_ms": offset * 86_400_000,
                "close_time_ms": offset * 86_400_000 + 86_399_999,
                "open": close * 0.99,
                "high": close * 1.01,
                "low": close * 0.98,
                "close": close,
                "volume": 1_000.0 + offset,
                "quote_volume": 2_000.0 + offset,
                "trade_count": 50 + offset,
                "taker_buy_volume": 500.0 + offset,
                "taker_buy_quote_volume": 750.0 + offset,
            }
        )
    return pl.DataFrame(rows)
