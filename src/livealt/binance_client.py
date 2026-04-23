from __future__ import annotations

import logging
import random
import time
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

import httpx
import polars as pl

from livealt.config import BinanceConfig


@dataclass(frozen=True)
class UniverseSymbol:
    symbol: str
    base_asset: str
    quote_asset: str
    contract_type: str
    status: str
    onboard_date: date | None


class BinanceClient:
    def __init__(self, config: BinanceConfig, logger: logging.Logger) -> None:
        self.config = config
        self.logger = logger
        self.client = httpx.Client(
            base_url=self.config.base_url,
            timeout=self.config.request_timeout_seconds,
            headers={"User-Agent": "livealt/0.1.0"},
        )

    def close(self) -> None:
        self.client.close()

    def _request_json(self, path: str, params: dict[str, Any] | None = None) -> Any:
        delay = self.config.retry_backoff_seconds
        for attempt in range(1, self.config.max_retries + 1):
            try:
                response = self.client.get(path, params=params)
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as exc:
                status_code = exc.response.status_code
                if status_code not in {418, 429, 500, 502, 503, 504} or attempt == self.config.max_retries:
                    raise
                self.logger.warning(
                    "Binance request failed with status %s on attempt %s/%s for %s.",
                    status_code,
                    attempt,
                    self.config.max_retries,
                    path,
                )
            except httpx.HTTPError:
                if attempt == self.config.max_retries:
                    raise
                self.logger.warning(
                    "Transient HTTP error on attempt %s/%s for %s.",
                    attempt,
                    self.config.max_retries,
                    path,
                )
            sleep_seconds = min(delay, self.config.max_backoff_seconds)
            time.sleep(sleep_seconds + random.uniform(0, 0.5))
            delay *= 2
        raise RuntimeError(f"Exceeded retry budget for Binance request {path}.")

    def fetch_exchange_info(self) -> list[dict[str, Any]]:
        payload = self._request_json(self.config.exchange_info_path)
        symbols = payload.get("symbols", [])
        if not isinstance(symbols, list):
            raise ValueError("Unexpected exchangeInfo payload: missing 'symbols'.")
        return symbols

    def fetch_daily_klines(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
    ) -> pl.DataFrame:
        if start_date > end_date:
            return pl.DataFrame()

        frames: list[pl.DataFrame] = []
        current_start = datetime.combine(start_date, datetime.min.time(), tzinfo=UTC)
        end_dt = datetime.combine(end_date + timedelta(days=1), datetime.min.time(), tzinfo=UTC)

        while current_start < end_dt:
            payload = self._request_json(
                self.config.klines_path,
                params={
                    "symbol": symbol,
                    "interval": self.config.klines_interval,
                    "startTime": int(current_start.timestamp() * 1000),
                    "endTime": int(end_dt.timestamp() * 1000) - 1,
                    "limit": self.config.kline_limit,
                },
            )
            if not payload:
                break
            frame = _klines_payload_to_frame(symbol, payload)
            if frame.is_empty():
                break
            frames.append(frame)
            last_open = frame.get_column("open_time_ms").max()
            current_start = datetime.fromtimestamp(last_open / 1000, tz=UTC) + timedelta(days=1)
            if frame.height < self.config.kline_limit:
                break

        if not frames:
            return pl.DataFrame()
        return (
            pl.concat(frames, how="vertical_relaxed")
            .unique(subset=["date"], keep="last")
            .sort("date")
        )


def last_complete_utc_day(now: datetime | None = None) -> date:
    now = now or datetime.now(tz=UTC)
    return (now - timedelta(days=1)).date()


def _klines_payload_to_frame(symbol: str, payload: list[list[Any]]) -> pl.DataFrame:
    rows: list[dict[str, Any]] = []
    for item in payload:
        open_time_ms = int(item[0])
        close_time_ms = int(item[6])
        dt = datetime.fromtimestamp(open_time_ms / 1000, tz=UTC)
        rows.append(
            {
                "symbol": symbol,
                "date": dt.date(),
                "open_time_ms": open_time_ms,
                "close_time_ms": close_time_ms,
                "open": float(item[1]),
                "high": float(item[2]),
                "low": float(item[3]),
                "close": float(item[4]),
                "volume": float(item[5]),
                "quote_volume": float(item[7]),
                "trade_count": int(item[8]),
                "taker_buy_volume": float(item[9]),
                "taker_buy_quote_volume": float(item[10]),
            }
        )
    return pl.DataFrame(rows)
