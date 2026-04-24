from __future__ import annotations

from datetime import date, timedelta
from typing import Any

import numpy as np
import polars as pl
from sklearn.cluster import AgglomerativeClustering
from sklearn.manifold import SpectralEmbedding

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

    raw_matrix = pivot.select(valid_columns).to_numpy().T
    matrix = _prepare_return_matrix(raw_matrix, config.clustering.return_mode)
    corr = _correlation_matrix(matrix)
    distance = _correlation_distance(corr)

    model = AgglomerativeClustering(
        n_clusters=None,
        metric="precomputed",
        linkage="average",
        distance_threshold=config.clustering.distance_threshold,
    )
    initial_labels = model.fit_predict(distance)
    labels = _split_large_clusters(
        distance=distance,
        labels=initial_labels,
        min_cluster_size=config.clustering.min_cluster_size,
        max_cluster_size=config.clustering.max_cluster_size,
        distance_threshold=config.clustering.distance_threshold,
    )
    labels = _relabel_small_clusters(labels, config.clustering.min_cluster_size)
    nearest_neighbors = _nearest_neighbors(valid_columns, corr, top_n=5)

    embedding: list[dict[str, Any]] = []
    if config.clustering.embed_2d and len(valid_columns) <= config.clustering.max_symbols_for_embedding:
        coords = _build_spectral_embedding(
            corr=corr,
            neighbors=config.clustering.knn_neighbors,
            random_state=config.clustering.random_state,
        )
        embedding = [
            {
                "symbol": symbol,
                "x": round(float(point[0]), 6),
                "y": round(float(point[1]), 6),
                "cluster_id": int(label) + 1 if label >= 0 else "noise",
                "nearest_neighbors": nearest_neighbors.get(symbol, []),
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
                "avg_residual_corr": round(avg_corr, 4),
                "top_members": top_members,
                "nearest_neighbors": [
                    {"symbol": symbol, "neighbors": nearest_neighbors.get(symbol, [])}
                    for symbol in members[:10]
                ],
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
        "return_mode": config.clustering.return_mode,
        "knn_neighbors": config.clustering.knn_neighbors,
        "max_cluster_size": config.clustering.max_cluster_size,
        "distance_metric": "sqrt(0.5 * (1 - residual correlation))",
        "embedding_method": "spectral embedding on kNN residual similarity graph",
        "min_cluster_size": config.clustering.min_cluster_size,
    }


def _prepare_return_matrix(matrix: np.ndarray, return_mode: str) -> np.ndarray:
    if matrix.size == 0:
        return matrix
    lower, upper = np.nanquantile(matrix, [0.01, 0.99])
    winsorized = np.clip(matrix, lower, upper)
    if return_mode != "residual" or matrix.shape[1] < 3:
        return winsorized

    market = winsorized.mean(axis=0)
    centered_market = market - market.mean()
    market_variance = float(centered_market @ centered_market)
    if market_variance <= 1e-12:
        return winsorized

    centered = winsorized - winsorized.mean(axis=1, keepdims=True)
    beta = centered @ centered_market / market_variance
    return centered - beta[:, None] * centered_market[None, :]


def _correlation_matrix(matrix: np.ndarray) -> np.ndarray:
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
    return np.clip(corr, -1.0, 1.0)


def _correlation_distance(corr: np.ndarray) -> np.ndarray:
    return np.sqrt(np.maximum(0.0, 0.5 * (1.0 - corr)))


def _split_large_clusters(
    distance: np.ndarray,
    labels: np.ndarray,
    min_cluster_size: int,
    max_cluster_size: int,
    distance_threshold: float,
) -> np.ndarray:
    adjusted = np.full_like(labels, -1)
    next_label = 0
    for label in sorted(set(labels)):
        indexes = np.flatnonzero(labels == label)
        if len(indexes) < min_cluster_size:
            continue
        if len(indexes) <= max_cluster_size:
            adjusted[indexes] = next_label
            next_label += 1
            continue

        subdistance = distance[np.ix_(indexes, indexes)]
        target_clusters = max(2, int(np.ceil(len(indexes) / max_cluster_size)))
        try:
            submodel = AgglomerativeClustering(
                n_clusters=None,
                metric="precomputed",
                linkage="average",
                distance_threshold=max(distance_threshold * 0.74, 0.22),
            )
            sublabels = submodel.fit_predict(subdistance)
        except ValueError:
            submodel = AgglomerativeClustering(
                n_clusters=target_clusters,
                metric="precomputed",
                linkage="average",
            )
            sublabels = submodel.fit_predict(subdistance)

        for sublabel in sorted(set(sublabels)):
            subindexes = indexes[sublabels == sublabel]
            if len(subindexes) < min_cluster_size:
                continue
            if len(subindexes) > max_cluster_size:
                chunks = np.array_split(subindexes, int(np.ceil(len(subindexes) / max_cluster_size)))
                for chunk in chunks:
                    if len(chunk) >= min_cluster_size:
                        adjusted[chunk] = next_label
                        next_label += 1
                continue
            adjusted[subindexes] = next_label
            next_label += 1
    return adjusted


def _nearest_neighbors(symbols: list[str], corr: np.ndarray, top_n: int) -> dict[str, list[dict[str, Any]]]:
    neighbors: dict[str, list[dict[str, Any]]] = {}
    for idx, symbol in enumerate(symbols):
        scores = [
            (symbols[other_idx], float(corr[idx, other_idx]))
            for other_idx in range(len(symbols))
            if other_idx != idx
        ]
        neighbors[symbol] = [
            {"symbol": neighbor, "score": round(score, 4)}
            for neighbor, score in sorted(scores, key=lambda item: item[1], reverse=True)[:top_n]
        ]
    return neighbors


def _build_spectral_embedding(corr: np.ndarray, neighbors: int, random_state: int) -> np.ndarray:
    sample_count = corr.shape[0]
    if sample_count == 0:
        return np.zeros((0, 2))
    if sample_count == 1:
        return np.zeros((1, 2))
    if sample_count == 2:
        return np.array([[-1.0, 0.0], [1.0, 0.0]])
    if np.allclose(corr, 1.0):
        return np.zeros((sample_count, 2))

    affinity = _knn_affinity(corr, neighbors)
    try:
        model = SpectralEmbedding(
            n_components=2,
            affinity="precomputed",
            random_state=random_state,
        )
        coords = model.fit_transform(affinity)
    except Exception:  # noqa: BLE001
        coords = _pca_embedding(corr)
    centered = coords - coords.mean(axis=0, keepdims=True)
    scale = centered.std(axis=0, ddof=1)
    scale[scale == 0] = 1.0
    return np.clip(centered / scale, -5.0, 5.0)


def _knn_affinity(corr: np.ndarray, neighbors: int) -> np.ndarray:
    sample_count = corr.shape[0]
    similarity = np.maximum(corr, 0.0)
    np.fill_diagonal(similarity, 1.0)
    keep_count = min(max(neighbors, 2), max(sample_count - 1, 1))
    affinity = np.zeros_like(similarity)
    for idx in range(sample_count):
        nearest = np.argsort(similarity[idx])[-keep_count - 1 :]
        affinity[idx, nearest] = similarity[idx, nearest]
    affinity = np.maximum(affinity, affinity.T)
    np.fill_diagonal(affinity, 1.0)
    return affinity


def _pca_embedding(corr: np.ndarray) -> np.ndarray:
    centered = corr - corr.mean(axis=0, keepdims=True)
    _, _, vh = np.linalg.svd(centered, full_matrices=False)
    coords = centered @ vh[:2].T
    if coords.shape[1] == 1:
        coords = np.column_stack([coords[:, 0], np.zeros(coords.shape[0])])
    return coords[:, :2]
