from __future__ import annotations

from pathlib import Path


def test_ma_distance_axis_domain_uses_full_universe() -> None:
    source = Path("site/src/components/MovingAverageMapPanel.tsx").read_text()

    assert "symmetricDomain(points.map((point) => point.x), 0.18)" in source
    assert "symmetricDomain(points.map((point) => point.y), 0.18)" in source
    assert "symmetricDomain(chartPoints.map((point) => point.x), 0.18)" not in source
    assert "symmetricDomain(chartPoints.map((point) => point.y), 0.18)" not in source
