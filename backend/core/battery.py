"""
Battery and flight-time estimation using momentum theory power model.

Public API
----------
FlightEstimate       — frozen dataclass returned by estimate_flight()
estimate_flight()    — single entry point: computes energy, time, and cumulative profile
hover_power_w()      — utility: hover power in watts for a given mass
cruise_power_w()     — utility: forward-flight power in watts at a given speed
"""

from __future__ import annotations

import dataclasses
import math

import numpy as np

import config
from core.types import FlightParams


@dataclasses.dataclass(frozen=True)
class FlightEstimate:
    """All energy and time estimates for a planned route."""

    energy_wh: float
    """Total electrical energy consumed in Watt-hours."""

    flight_time_s: float
    """Total flight time in seconds."""

    cumulative_wh: np.ndarray
    """Per-point cumulative energy in Wh, shape (N,). cumulative_wh[0] == 0."""

    budget_pct: float
    """energy_wh / battery_wh × 100. May exceed 100 (over-budget mission)."""


# ── Power utilities ────────────────────────────────────────────────────────────


def hover_power_w(weight_kg: float) -> float:
    """Momentum theory hover power: P = HOVER_POWER_SCALE_W × weight_kg^1.5 (Watts)."""
    return config.HOVER_POWER_SCALE_W * weight_kg ** 1.5


def cruise_power_w(weight_kg: float, speed_ms: float) -> float:
    """Total electrical power at forward cruise speed, excluding climb (Watts).

    Uses the Glauert/Leishman modified momentum theory for induced power,
    plus blade profile drag and body parasite drag:

        v_i            = P_hover / (weight_kg × g)          [induced velocity at hover]
        induced_factor = 1 / sqrt(sqrt(1+(v/v_i)^4/4) + (v/v_i)^2/2)
        P_induced      = P_hover × induced_factor
        P_profile      = PROFILE_POWER_FRACTION × P_hover
        P_parasite     = 0.5 × rho × Cd*A × v^3
    """
    p_hover = hover_power_w(weight_kg)
    v_i = p_hover / (weight_kg * config.GRAVITY_MS2)
    v_ratio = speed_ms / v_i
    induced_factor = 1.0 / math.sqrt(
        math.sqrt(1.0 + v_ratio ** 4 / 4.0) + v_ratio ** 2 / 2.0
    )
    p_induced = p_hover * induced_factor
    p_profile = config.PROFILE_POWER_FRACTION * p_hover
    p_parasite = 0.5 * config.AIR_DENSITY_KGM3 * config.PARASITE_DRAG_COEFF * speed_ms ** 3
    return p_induced + p_profile + p_parasite


# ── Main estimator ─────────────────────────────────────────────────────────────


def estimate_flight(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    params: FlightParams,
) -> FlightEstimate:
    """Compute energy and time estimates for a dense 3-D route.

    Energy model per segment:
      - Cruise: cruise_power_w(weight, speed) × segment_time
      - Climb penalty: weight × g × Δh  (Joules, ascent only; descent not recovered)

    Time model per segment:
      - max(horiz_dist / cruise_speed, climb_height / climb_rate)

    Parameters
    ----------
    utm_points : (N, 2) array of easting / northing in metres.
    altitudes  : (N,) array of MSL altitudes in metres.
    params     : FlightParams carrying weight, speed, climb rate and battery capacity.

    Returns
    -------
    FlightEstimate with total energy, flight time, per-point cumulative energy, and
    battery budget percentage.
    """
    n = len(utm_points)
    if n < 2:
        return FlightEstimate(
            energy_wh=0.0,
            flight_time_s=0.0,
            cumulative_wh=np.zeros(n),
            budget_pct=0.0,
        )

    diffs_2d = np.diff(utm_points, axis=0)
    horiz_dists = np.hypot(diffs_2d[:, 0], diffs_2d[:, 1])
    alt_deltas = np.diff(altitudes)
    climb_deltas = np.maximum(0.0, alt_deltas)

    horiz_times = horiz_dists / params.cruise_speed_ms
    climb_times = np.where(climb_deltas > 0, climb_deltas / params.climb_rate_ms, 0.0)
    seg_times = np.maximum(horiz_times, climb_times)

    p_cruise = cruise_power_w(params.drone_weight_kg, params.cruise_speed_ms)
    e_cruise_j = p_cruise * seg_times
    e_climb_j = params.drone_weight_kg * config.GRAVITY_MS2 * climb_deltas

    seg_wh = (e_cruise_j + e_climb_j) / 3600.0
    cumulative_wh = np.concatenate([[0.0], np.cumsum(seg_wh)])

    total_energy_wh = float(cumulative_wh[-1])
    total_time_s = float(np.sum(seg_times))
    budget_pct = (
        (100.0 * total_energy_wh / params.battery_wh)
        if params.battery_wh > 0
        else float("inf")
    )

    return FlightEstimate(
        energy_wh=total_energy_wh,
        flight_time_s=total_time_s,
        cumulative_wh=cumulative_wh,
        budget_pct=budget_pct,
    )
