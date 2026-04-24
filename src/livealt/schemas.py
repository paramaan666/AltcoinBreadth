from __future__ import annotations


SCHEMA_VERSION = {
    "type": "object",
    "required": ["version"],
    "properties": {
        "version": {"type": "string"},
    },
}


OVERVIEW_SCHEMA = {
    "type": "object",
    "required": [
        "as_of_date",
        "updated_at_utc",
        "tracked_symbols",
        "eligible_symbols",
        "above_count",
        "above_pct",
        "below_count",
    ],
    "properties": {
        "as_of_date": {"type": ["string", "null"]},
        "updated_at_utc": {"type": "string"},
        "tracked_symbols": {"type": "integer"},
        "eligible_symbols": {"type": "integer"},
        "above_count": {"type": "integer"},
        "above_pct": {"type": "number"},
        "below_count": {"type": "integer"},
    },
}


BREADTH_HISTORY_SCHEMA = {
    "type": "object",
    "required": ["series"],
    "properties": {
        "series": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["date", "eligible_count", "above_count", "above_pct"],
                "properties": {
                    "date": {"type": "string"},
                    "eligible_count": {"type": "integer"},
                    "above_count": {"type": "integer"},
                    "above_pct": {"type": "number"},
                },
            },
        }
    },
}


SNAPSHOT_SCHEMA = {
    "type": "object",
    "required": ["as_of_date", "rows"],
    "properties": {
        "as_of_date": {"type": ["string", "null"]},
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": [
                    "symbol",
                    "close",
                    "ma_30w",
                    "raw_distance_pct",
                    "atr_pct_60",
                    "normalized_distance",
                    "momentum_30d_pct",
                    "days_history",
                ],
                "properties": {
                    "symbol": {"type": "string"},
                    "close": {"type": "number"},
                    "ma_30w": {"type": "number"},
                    "raw_distance_pct": {"type": "number"},
                    "atr_pct_60": {"type": "number"},
                    "normalized_distance": {"type": ["number", "null"]},
                    "momentum_30d_pct": {"type": "number"},
                    "days_history": {"type": "integer"},
                },
            },
        },
    },
}


CLUSTERS_SCHEMA = {
    "type": "object",
    "required": ["as_of_date", "params", "clusters", "unassigned_symbols", "embedding"],
    "properties": {
        "as_of_date": {"type": ["string", "null"]},
        "params": {"type": "object"},
        "clusters": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["cluster_id", "label", "size", "symbols"],
                "properties": {
                    "cluster_id": {"type": "integer"},
                    "label": {"type": "string"},
                    "size": {"type": "integer"},
                    "symbols": {"type": "array", "items": {"type": "string"}},
                    "avg_residual_corr": {"type": "number"},
                    "nearest_neighbors": {"type": "array"},
                },
            },
        },
        "unassigned_symbols": {"type": "array", "items": {"type": "string"}},
        "embedding": {"type": "array"},
    },
}


ROTATION_SCHEMA = {
    "type": "object",
    "required": ["as_of_date", "trail_days", "lookbacks", "summary", "rows"],
    "properties": {
        "as_of_date": {"type": ["string", "null"]},
        "trail_days": {"type": "integer"},
        "lookbacks": {"type": "array", "items": {"type": "integer"}},
        "summary": {"type": "object"},
        "rows": {
            "type": "array",
            "items": {
                "type": "object",
                "required": ["symbol", "quadrant", "trend_direction", "current", "deltas", "trail"],
                "properties": {
                    "symbol": {"type": "string"},
                    "quadrant": {"type": "string"},
                    "trend_direction": {"type": "string"},
                    "current": {"type": "object"},
                    "deltas": {"type": "object"},
                    "trail": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "required": [
                                "date",
                                "close",
                                "ma_30w",
                                "momentum_30d_pct",
                                "raw_distance_pct",
                                "normalized_distance",
                            ],
                            "properties": {
                                "date": {"type": "string"},
                                "close": {"type": "number"},
                                "ma_30w": {"type": "number"},
                                "momentum_30d_pct": {"type": "number"},
                                "raw_distance_pct": {"type": "number"},
                                "normalized_distance": {"type": ["number", "null"]},
                            },
                        },
                    },
                },
            },
        },
    },
}


METHODOLOGY_SCHEMA = {
    "type": "object",
    "required": ["breadth", "distance", "rotation", "clusters", "lifecycle"],
    "properties": {
        "breadth": {"type": "object"},
        "distance": {"type": "object"},
        "rotation": {"type": "object"},
        "clusters": {"type": "object"},
        "lifecycle": {"type": "object"},
    },
}


VALIDATION_SCHEMA = {
    "type": "object",
    "required": ["checks", "passed"],
    "properties": {
        "checks": {"type": "array"},
        "passed": {"type": "boolean"},
    },
}
