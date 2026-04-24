from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class PathsConfig:
    data_dir: Path
    universe_dir: Path
    klines_dir: Path
    manifests_dir: Path
    logs_dir: Path
    outputs_dir: Path
    validation_dir: Path
    site_public_data_dir: Path


@dataclass(frozen=True)
class BinanceConfig:
    base_url: str
    exchange_info_path: str
    klines_path: str
    archive_base_url: str
    archive_bucket_listing_url: str
    request_timeout_seconds: int
    max_retries: int
    retry_backoff_seconds: float
    max_backoff_seconds: float
    kline_limit: int
    klines_interval: str


@dataclass(frozen=True)
class UniverseConfig:
    quote_asset: str
    required_contract_type: str
    required_status: str
    delist_confirmation_days: int
    exclude_symbols: list[str]


@dataclass(frozen=True)
class IndicatorsConfig:
    ma_days: int
    atr_days: int
    momentum_days: int
    min_days_for_cluster: int


@dataclass(frozen=True)
class RotationConfig:
    trail_days: int
    lookbacks: list[int]


@dataclass(frozen=True)
class ClusteringConfig:
    lookback_days: int
    return_mode: str
    knn_neighbors: int
    distance_threshold: float
    min_cluster_size: int
    max_cluster_size: int
    embed_2d: bool
    max_symbols_for_embedding: int
    random_state: int


@dataclass(frozen=True)
class BootstrapConfig:
    auto_seed_on_empty: bool
    local_seed_path: Path | None


@dataclass(frozen=True)
class ValidationConfig:
    min_success_ratio: float


@dataclass(frozen=True)
class AppConfig:
    repo_root: Path
    paths: PathsConfig
    binance: BinanceConfig
    universe: UniverseConfig
    indicators: IndicatorsConfig
    rotation: RotationConfig
    clustering: ClusteringConfig
    bootstrap: BootstrapConfig
    validation: ValidationConfig


def _resolve_path(value: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        data = yaml.safe_load(handle)
    if not isinstance(data, dict):
        raise ValueError(f"Config file {path} must contain a mapping.")
    return data


def load_config(path: str | Path | None = None) -> AppConfig:
    config_path = _resolve_path(str(path or "config/settings.yaml"))
    raw = _load_yaml(config_path)

    paths = PathsConfig(
        data_dir=_resolve_path(raw["paths"]["data_dir"]),
        universe_dir=_resolve_path(raw["paths"]["universe_dir"]),
        klines_dir=_resolve_path(raw["paths"]["klines_dir"]),
        manifests_dir=_resolve_path(raw["paths"]["manifests_dir"]),
        logs_dir=_resolve_path(raw["paths"]["logs_dir"]),
        outputs_dir=_resolve_path(raw["paths"]["outputs_dir"]),
        validation_dir=_resolve_path(raw["paths"]["validation_dir"]),
        site_public_data_dir=_resolve_path(raw["paths"]["site_public_data_dir"]),
    )
    binance = BinanceConfig(**raw["binance"])
    universe = UniverseConfig(**raw["universe"])
    indicators = IndicatorsConfig(**raw["indicators"])
    rotation = RotationConfig(**raw["rotation"])
    clustering = ClusteringConfig(**raw["clustering"])
    bootstrap_data = raw["bootstrap"].copy()
    local_seed_path = bootstrap_data.get("local_seed_path")
    bootstrap = BootstrapConfig(
        auto_seed_on_empty=bootstrap_data["auto_seed_on_empty"],
        local_seed_path=_resolve_path(local_seed_path) if local_seed_path else None,
    )
    validation = ValidationConfig(**raw["validation"])
    return AppConfig(
        repo_root=REPO_ROOT,
        paths=paths,
        binance=binance,
        universe=universe,
        indicators=indicators,
        rotation=rotation,
        clustering=clustering,
        bootstrap=bootstrap,
        validation=validation,
    )


def ensure_directories(config: AppConfig) -> None:
    for path in (
        config.paths.data_dir,
        config.paths.universe_dir,
        config.paths.universe_dir / "snapshots",
        config.paths.klines_dir,
        config.paths.manifests_dir,
        config.paths.logs_dir,
        config.paths.outputs_dir,
        config.paths.validation_dir,
        config.paths.site_public_data_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)
