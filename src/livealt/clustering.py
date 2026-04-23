from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import polars as pl
from sklearn.cluster import AgglomerativeClustering
from sklearn.manifold import MDS

from livealt.config import AppConfig


def build_clusters(config: AppConfig, metrics: pl.DataFrame, as_of_date: str | None) -> dict[str, Any]:
    if metrics.is_empty() or as_of_date is None:
        return {
            "as_of_date": as_of_date,
            "params": _cluster_params(config),
            "clusters": [],
            "unassigned_symbols": [],
            "embedding": [],
        }

    as_of = date.fromisoformat(as_of_date)
    start_date = as_of - timedelta(days=config.clustering.lookback_days - 1)
    current_symbols = (
        metrics.filter((pl.col("date") == pl.lit(as_of)) & pl.col("active_on_date"))
        .get_column("symbol")
        .to_list()
    )
    returns = (
        metrics.filter(
            pl.col("symbol").is_in(current_symbols)
            & (pl.col("date") >= pl.lit(start_date))
            & (pl.col("date") <= pl.lit(as_of))
        )
        .select(["date", "symbol", "log_return"])
    )
    if returns.is_empty():
        return {
            "as_of_date": as_of_date,
            "params": _cluster_params(config),
            "clusters": [],
            "unassigned_symbols": sorted(current_symbols),
            "embedding": [],
        }

    pivot = returns.pivot(on="symbol", index="date", values="log_return").sort("date")
    date_count = pivot.height
    if date_count < config.clustering.lookback_days:
        return {
            "as_of_date": as_of_date,
            "params": _cluster_params(config),
            "clusters": [],
            "unassigned_symbols": sorted(current_symbols),
            "embedding": [],
        }
    symbol_columns = [column for column in pivot.columns if column != "date"]
    valid_columns = [
        column
        for column in symbol_columns
        if pivot.select(pl.col(column).is_not_null().all()).item()
    ]
    if len(valid_columns) < config.clustering.min_cluster_size:
        return {
            "as_of_date": as_of_date,
            "params": _cluster_params(config),
            "clusters": [],
            "unassigned_symbols": sorted(current_symbols),
            "embedding": [],
        }

    matrix = pivot.select(valid_columns).to_numpy().T
    centered = matrix - matrix.mean(axis=1, keepdims=True)
    std = centered.std(axis=1, ddof=1)
    normalized = np.zeros_like(centered)
    valid = std > 0
    if matrix.shape[1] > 1:
        normalized[valid] = centered[valid] / std[valid, None]
        corr = normalized @ normalized.T / (matrix.shape[1] - 1)
    else:
        corr = np.zeros((matrix.shape[0], matrix.shape[0]))
    np.fill_diagonal(corr, 1.0)
    corr = np.clip(corr, -1.0, 1.0)
    distance = np.sqrt(0.5 * (1.0 - corr))

    model = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=config.clustering.distance_threshold,
    )
    labels = model.fit_predict(distance)
    labels = _relabel_small_clusters(labels, config.clustering.min_cluster_size)

    embedding: list[dict[str, Any]] = []
    if config.clustering.embed_2d and len(valid_columns) <= config.clustering.max_symbols_for_embedding:
        mds = MDS(
            n_components=2,
            dissimilarity="precomputed",
            random_state=config.clustering.random_state,
            n_init=1,
            max_iter=300,
        )
        coords = mds.fit_transform(distance)
        embedding = [
            {
                "symbol": symbol,
                "x": round(float(point[0]), 6),
                "y": round(float(point[1]), 6),
                "cluster_id": int(label) if label >= 0 else "noise",
            }
            for symbol, point, label in zip(valid_columns, coords, labels, strict=True)
        ]

    clusters: list[dict[str, Any]] = []
    unassigned: list[str] = []
    for label in sorted(set(labels)):
        members = [symbol for symbol, member_label in zip(valid_columns, labels, strict=True) if member_label == label]
        if label < 0:
            unassigned.extend(members)
            continue
        member_indexes = [valid_columns.index(symbol) for symbol in members]
        sub_corr = corr[np.ix_(member_indexes, member_indexes)]
        avg_corr = float(sub_corr.mean()) if len(member_indexes) else 0.0
        centrality = {symbol: float(sub_corr[idx].mean()) for idx, symbol in enumerate(members)}
        top_members = [
            {"symbol": symbol, "weight": round(weight, 4)}
            for symbol, weight in sorted(centrality.items(), key=lambda item: item[1], reverse=True)[:10]
        ]
        clusters.append(
            {
                "cluster_id": int(label) + 1,
                "label": f"Cluster {int(label) + 1}",
                "size": len(members),
                "symbols": members,
                "avg_pairwise_corr": round(avg_corr, 4),
                "top_members": top_members,
            }
        )

    return {
        "as_of_date": as_of_date,
        "params": _cluster_params(config),
        "clusters": clusters,
        "unassigned_symbols": sorted(unassigned),
        "embedding": embedding,
    }


def _relabel_small_clusters(labels: np.ndarray, min_cluster_size: int) -> np.ndarray:
    adjusted = labels.copy()
    next_label = 0
    remap: dict[int, int] = {}
    for label in sorted(set(labels)):
        if label < 0:
            remap[label] = -1
            continue
        size = int((labels == label).sum())
        if size < min_cluster_size:
            remap[label] = -1
        else:
            remap[label] = next_label
            next_label += 1
    return np.array([remap[label] for label in adjusted], dtype=int)


def _cluster_params(config: AppConfig) -> dict[str, Any]:
    return {
        "algorithm": "agglomerative-average-linkage",
        "lookback_days": config.clustering.lookback_days,
        "distance_threshold": config.clustering.distance_threshold,
        "distance_metric": "sqrt(0.5 * (1 - correlation))",
        "min_cluster_size": config.clustering.min_cluster_size,
    }
