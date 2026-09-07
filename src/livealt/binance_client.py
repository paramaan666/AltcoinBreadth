from __future__ import annotations

import csv
import io
import logging
import random
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from xml.etree import ElementTree
from typing import Any

import httpx
import polars as pl

from livealt.config import BinanceConfig


ARCHIVE_FULL_BACKFILL_DAYS = 365


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

    def list_archive_symbols(self) -> list[str]:
        root = self._request_xml(
            self.config.archive_bucket_listing_url,
            params={
                "prefix": "data/futures/um/daily/klines/",
                "delimiter": "/",
            },
        )
        namespace = {"s3": "http://s3.amazonaws.com/doc/2006-03-01/"}
        symbols: list[str] = []
        for node in root.findall("s3:CommonPrefixes", namespace):
            prefix_node = node.find("s3:Prefix", namespace)
            if prefix_node is None or not prefix_node.text:
                continue
            symbol = prefix_node.text.rstrip("/").split("/")[-1]
            symbols.append(symbol)
        return sorted(symbols)

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

    def fetch_archive_daily_klines(
        self,
        symbol: str,
        start_date: date,
        end_date: date,
        full_backfill: bool = False,
    ) -> pl.DataFrame:
        if start_date > end_date:
            return pl.DataFrame()

        if full_backfill:
            earliest_backfill_date = end_date - timedelta(days=ARCHIVE_FULL_BACKFILL_DAYS - 1)
            start_date = max(start_date, earliest_backfill_date)

        current_month_start = datetime.now(tz=UTC).date().replace(day=1)
        frames = []
        for month_start in _month_starts_between(start_date, end_date):
            month_end = _month_end(month_start)
            month_range_start = max(start_date, month_start)
            month_range_end = min(end_date, month_end)
            if month_end < current_month_start:
                key = f"data/futures/um/monthly/klines/{symbol}/1d/{symbol}-1d-{month_start:%Y-%m}.zip"
                frame = self._download_archive_frame(key, symbol, allow_missing=True)
                if not frame.is_empty():
                    frames.append(frame)
                # Completed months are represented by a single monthly archive.
                # If it does not exist, the symbol had no archived data for that month;
                # probing every individual day is both redundant and extremely slow.
                continue
            for day in _days_in_range(month_range_start, month_range_end):
                key = f"data/futures/um/daily/klines/{symbol}/1d/{symbol}-1d-{day.isoformat()}.zip"
                frame = self._download_archive_frame(key, symbol, allow_missing=True)
                if not frame.is_empty():
                    frames.append(frame)

        if not frames:
            return pl.DataFrame()
        return (
            pl.concat(frames, how="vertical_relaxed")
            .filter((pl.col("date") >= pl.lit(start_date)) & (pl.col("date") <= pl.lit(end_date)))
            .unique(subset=["date"], keep="last")
            .sort("date")
        )

    def has_archive_daily_kline(self, symbol: str, on_date: date) -> bool:
        key = f"data/futures/um/daily/klines/{symbol}/1d/{symbol}-1d-{on_date.isoformat()}.zip"
        return not self._download_archive_frame(key, symbol, allow_missing=True).is_empty()

    def _request_xml(
        self,
        url: str,
        params: dict[str, Any] | None = None,
    ) -> ElementTree.Element:
        delay = self.config.retry_backoff_seconds
        for attempt in range(1, self.config.max_retries + 1):
            try:
                response = self.client.get(url, params=params)
                response.raise_for_status()
                return ElementTree.fromstring(response.text)
            except Exception:
                if attempt == self.config.max_retries:
                    raise
                time.sleep(min(delay, self.config.max_backoff_seconds) + random.uniform(0, 0.5))
                delay *= 2
        raise RuntimeError(f"Exceeded retry budget for XML request {url}.")

    def _download_archive_frame(
        self,
        archive_key: str,
        symbol: str,
        allow_missing: bool = False,
    ) -> pl.DataFrame:
        url = f"{self.config.archive_base_url}/{archive_key}"
        response = self.client.get(url)
        if response.status_code == 404 and allow_missing:
            return pl.DataFrame()
        response.raise_for_status()
        with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
            names = archive.namelist()
            if not names:
                return pl.DataFrame()
            with archive.open(names[0]) as handle:
                content = handle.read().decode("utf-8")
        reader = csv.reader(io.StringIO(content))
        rows: list[dict[str, Any]] = []
        for item in reader:
            if not item:
                continue
            try:
                open_time_ms = int(item[0])
            except ValueError:
                continue
            dt = datetime.fromtimestamp(open_time_ms / 1000, tz=UTC)
            rows.append(
                {
                    "symbol": symbol,
                    "date": dt.date(),
                    "open_time_ms": open_time_ms,
                    "close_time_ms": int(item[6]),
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


def last_complete_utc_day(now: datetime | None = None) -> date:
    now = now or datetime.now(tz=UTC)
    return (now - timedelta(days=1)).date()


def is_archive_fallback_error(exc: Exception) -> bool:
    if not isinstance(exc, httpx.HTTPStatusError):
        return False
    return exc.response.status_code == 451


def _days_in_range(start_date: date, end_date: date) -> list[date]:
    current = start_date
    days: list[date] = []
    while current <= end_date:
        days.append(current)
        current += timedelta(days=1)
    return days


def _month_starts_between(start_date: date, end_date: date) -> list[date]:
    current = start_date.replace(day=1)
    starts: list[date] = []
    while current <= end_date:
        starts.append(current)
        if current.month == 12:
            current = current.replace(year=current.year + 1, month=1, day=1)
        else:
            current = current.replace(month=current.month + 1, day=1)
    return starts


def _month_end(month_start: date) -> date:
    if month_start.month == 12:
        next_month = month_start.replace(year=month_start.year + 1, month=1, day=1)
    else:
        next_month = month_start.replace(month=month_start.month + 1, day=1)
    return next_month - timedelta(days=1)


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
