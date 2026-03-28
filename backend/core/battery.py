"""
Battery and flight-time estimation.
All functions are pure — arrays in, scalars out.
"""

from __future__ import annotations

import numpy as np

import config
from core.types import FlightParams


def _compute_segment_arrays(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (horiz_dists, horiz_times, climb_deltas) arrays for adjacent route segments."""
    diffs_2d = np.diff(utm_points, axis=0)
    horiz_dists = np.hypot(diffs_2d[:, 0], diffs_2d[:, 1])
    alt_deltas = np.diff(altitudes)
    climb_deltas = np.maximum(0.0, alt_deltas)
    return horiz_dists, alt_deltas, climb_deltas


def estimate_energy_wh(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    flight_cfg: FlightParams,
) -> float:
    """Estimate total energy consumption in Watt-hours.

    Power model:
      - Horizontal flight: P_horiz = (weight_kg ^ POWER_COEFF * speed_ms) / HOVER_EFFICIENCY
        Energy per segment: P_horiz * (dist_m / speed_ms) = P_horiz * time_s
      - Vertical (climb only): E_climb = weight_kg * g * delta_h  [Joules]
        (descent recovers no energy — conservative estimate)

    Both converted to Wh by dividing by 3600.
    """
    if len(utm_points) < 2:
        return 0.0

    horiz_dists, _alt_deltas, climb_deltas = _compute_segment_arrays(utm_points, altitudes)

    # Horizontal power (Watts)
    p_horiz = (flight_cfg.drone_weight_kg ** config.POWER_COEFF * flight_cfg.cruise_speed_ms) / config.HOVER_EFFICIENCY

    # Horizontal energy (Joules)
    horiz_times_s = horiz_dists / flight_cfg.cruise_speed_ms
    e_horiz_j = p_horiz * np.sum(horiz_times_s)

    # Climb energy (Joules): E = m * g * Δh
    e_climb_j = flight_cfg.drone_weight_kg * config.GRAVITY_MS2 * np.sum(climb_deltas)

    total_j = e_horiz_j + e_climb_j
    return total_j / 3600.0


def estimate_flight_time_s(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    flight_cfg: FlightParams,
) -> float:
    """Estimate total flight time in seconds.

    Horizontal segments: time = distance / cruise_speed_ms.
    Vertical climbs: time = Δh / climb_rate_ms (if the climb time exceeds the horizontal
    time for that segment, the vertical rate is the binding constraint).
    """
    if len(utm_points) < 2:
        return 0.0

    horiz_dists, _alt_deltas, climb_deltas = _compute_segment_arrays(utm_points, altitudes)

    horiz_times = horiz_dists / flight_cfg.cruise_speed_ms
    climb_times = np.where(climb_deltas > 0, climb_deltas / flight_cfg.climb_rate_ms, 0.0)
    # For each segment, the drone is bound by whichever takes longer
    segment_times = np.maximum(horiz_times, climb_times)
    return float(np.sum(segment_times))


def cumulative_energy_wh(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    flight_cfg: FlightParams,
) -> np.ndarray:
    """Return per-point cumulative energy consumption in Wh (shape N,).

    Uses the same model as estimate_energy_wh but accumulated segment-by-segment
    so callers can find the distance at which a given battery fraction is reached.
    """
    n = len(utm_points)
    if n < 2:
        return np.zeros(n)

    horiz_dists, _alt_deltas, climb_deltas = _compute_segment_arrays(utm_points, altitudes)

    p_horiz = (flight_cfg.drone_weight_kg ** config.POWER_COEFF * flight_cfg.cruise_speed_ms) / config.HOVER_EFFICIENCY
    horiz_times_s = horiz_dists / flight_cfg.cruise_speed_ms
    e_horiz_j = p_horiz * horiz_times_s
    e_climb_j = flight_cfg.drone_weight_kg * config.GRAVITY_MS2 * climb_deltas

    seg_energy_wh = (e_horiz_j + e_climb_j) / 3600.0
    cum = np.concatenate([[0.0], np.cumsum(seg_energy_wh)])
    return cum
