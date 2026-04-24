from __future__ import annotations

from typing import Any

from jsonschema import validate

from livealt.schemas import (
    BREADTH_HISTORY_SCHEMA,
    CLUSTERS_SCHEMA,
    METHODOLOGY_SCHEMA,
    OVERVIEW_SCHEMA,
    ROTATION_SCHEMA,
    SCHEMA_VERSION,
    SNAPSHOT_SCHEMA,
    VALIDATION_SCHEMA,
)


def validate_output_bundle(
    overview: dict[str, Any],
    breadth_history: list[dict[str, Any]],
    above_rows: list[dict[str, Any]],
    below_rows: list[dict[str, Any]],
    rotation: dict[str, Any],
    clusters: dict[str, Any],
    methodology: dict[str, Any],
    min_success_ratio: float,
    symbol_statuses: dict[str, Any],
) -> dict[str, Any]:
    checks: list[dict[str, Any]] = []

    validate(overview, OVERVIEW_SCHEMA)
    checks.append({"name": "overview_schema", "passed": True})

    breadth_payload = {"series": breadth_history}
    validate(breadth_payload, BREADTH_HISTORY_SCHEMA)
    checks.append({"name": "breadth_schema", "passed": True})
    for row in breadth_history:
        if row["above_count"] > row["eligible_count"]:
            raise ValueError("above_count cannot exceed eligible_count.")
        if not 0 <= row["above_pct"] <= 100:
            raise ValueError("above_pct must be between 0 and 100.")
    checks.append({"name": "breadth_values", "passed": True})

    above_payload = {"as_of_date": overview.get("as_of_date"), "rows": above_rows}
    below_payload = {"as_of_date": overview.get("as_of_date"), "rows": below_rows}
    validate(above_payload, SNAPSHOT_SCHEMA)
    validate(below_payload, SNAPSHOT_SCHEMA)
    checks.append({"name": "snapshot_schema", "passed": True})

    validate(rotation, ROTATION_SCHEMA)
    for row in rotation.get("rows", []):
        trail = row.get("trail", [])
        if len(trail) > rotation.get("trail_days", 0) + 1:
            raise ValueError("Rotation trail exceeds configured trail_days plus current point.")
        trail_dates = {point.get("date") for point in trail}
        for lookback, delta in row.get("deltas", {}).items():
            from_date = delta.get("from_date")
            if from_date and from_date not in trail_dates:
                raise ValueError(f"Rotation delta {lookback} starts outside stored trail for {row.get('symbol')}.")
    checks.append({"name": "rotation_schema", "passed": True})

    validate(clusters, CLUSTERS_SCHEMA)
    checks.append({"name": "clusters_schema", "passed": True})

    validate(methodology, METHODOLOGY_SCHEMA)
    validate({"version": "1.0.0"}, SCHEMA_VERSION)
    checks.append({"name": "methodology_schema", "passed": True})

    success_count = len([state for state in symbol_statuses.values() if state.get("status") == "success"])
    total = len(symbol_statuses) or 1
    success_ratio = success_count / total
    if success_ratio < min_success_ratio:
        raise ValueError(
            f"Successful symbol update ratio {success_ratio:.2%} is below required {min_success_ratio:.2%}."
        )
    checks.append({"name": "success_ratio", "passed": True, "value": round(success_ratio, 4)})

    report = {
        "passed": all(check["passed"] for check in checks),
        "checks": checks,
    }
    validate(report, VALIDATION_SCHEMA)
    return report
