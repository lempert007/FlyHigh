"""
Shared geometry utilities.

Centralises algorithms that are used by multiple modules so there is
a single implementation to maintain.
"""

from __future__ import annotations

import numpy as np


def points_in_polygon_utm(
    ex: np.ndarray,
    ny: np.ndarray,
    poly_e: np.ndarray,
    poly_n: np.ndarray,
) -> np.ndarray:
    """Vectorised ray-casting point-in-polygon test in UTM coordinates.

    Args:
        ex: 1-D array of query point eastings.
        ny: 1-D array of query point northings (same length as ex).
        poly_e: 1-D array of polygon vertex eastings.
        poly_n: 1-D array of polygon vertex northings (same length as poly_e).

    Returns:
        Boolean array of length len(ex), True where the point is inside.
    """
    inside = np.zeros(len(ex), dtype=bool)
    n = len(poly_e)
    j = n - 1
    for i in range(n):
        cond = (
            ((poly_n[i] > ny) != (poly_n[j] > ny))
            & (
                ex
                < (poly_e[j] - poly_e[i])
                * (ny - poly_n[i])
                / (poly_n[j] - poly_n[i] + 1e-15)
                + poly_e[i]
            )
        )
        inside ^= cond
        j = i
    return inside
