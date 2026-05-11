"""
AGL altitude profile chart: distance vs altitude, self-contained Plotly HTML.
"""

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go

from export.html_utils import inject_dark_fullscreen_css
from models import FlightConfig


def render_profile_html(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    terrain_elevs: np.ndarray,
    cum_distances: np.ndarray,
    flight_cfg: FlightConfig,
    poi_distances: list[float] | None = None,
    return_home_distance: float | None = None,
    poi_band_overrides: list[tuple[float, float, float, float]] | None = None,
    poi_scan_areas: list[tuple[float, float]] | None = None,
    violation_points: list[tuple[int, str]] | None = None,
    bubble_peak_terrain: np.ndarray | None = None,
    camera_min_terrain: np.ndarray | None = None,
) -> str:
    """Build a standalone Plotly HTML altitude profile chart.

    Args:
        poi_band_overrides: list of (start_m, end_m, min_agl, max_agl) — per-POI
            AGL band overrides applied on top of the global band.
        return_home_distance: cumulative distance (metres) at which the drone
            starts the return-to-home leg (i.e. the landing keypoint distance).
        bubble_peak_terrain: peak terrain elevation within the safety bubble disc
            at each route point. When provided, used as the floor reference for
            the min AGL band instead of the terrain directly below the drone.
        camera_min_terrain: minimum terrain elevation within the camera range disc
            at each route point. When provided, used as the ceiling reference for
            the max AGL band.

    Returns a self-contained HTML string.
    """
    fig = go.Figure()

    dist = cum_distances / 1000.0  # metres → kilometres for readability
    ground = terrain_elevs
    floor_ref = bubble_peak_terrain if bubble_peak_terrain is not None else ground
    ceil_ref = camera_min_terrain if camera_min_terrain is not None else ground

    # Per-point slope in m/m (signed: positive = climbing).
    # Use gradient over cumulative distance in metres.
    with np.errstate(divide="ignore", invalid="ignore"):
        slope = np.gradient(altitudes.astype(float), cum_distances.astype(float))

    def _slope_label(s: float) -> str:
        if abs(s) < 1e-4:
            return "flat"
        sign = "↑" if s > 0 else "↓"
        return f"{sign} 1/{abs(1.0 / s):.0f}"

    slope_labels = np.array([_slope_label(s) for s in slope])

    # Build per-point AGL band arrays — start from global values then apply overrides.
    # floor_ref is the peak terrain within the safety bubble disc (worst-case ground
    # reference for the minimum clearance), ceil_ref is the min terrain within the
    # camera range disc (worst-case reference for the maximum clearance).
    min_band = floor_ref + flight_cfg.min_agl_m
    max_band = ceil_ref + flight_cfg.max_agl_m

    if poi_band_overrides:
        min_band = min_band.copy()
        max_band = max_band.copy()
        for start_m, end_m, poi_min, poi_max in poi_band_overrides:
            mask = (cum_distances >= start_m) & (cum_distances <= end_m)
            min_band[mask] = floor_ref[mask] + poi_min
            max_band[mask] = ceil_ref[mask] + poi_max

    # Shaded AGL band (min → max)
    fig.add_trace(
        go.Scatter(
            x=np.concatenate([dist, dist[::-1]]),
            y=np.concatenate([max_band, min_band[::-1]]),
            fill="toself",
            fillcolor="rgba(100, 200, 255, 0.15)",
            line=dict(color="rgba(0,0,0,0)"),
            name="AGL band",
            hoverinfo="skip",
        )
    )

    # Ground terrain fill
    fig.add_trace(
        go.Scatter(
            x=dist,
            y=ground,
            fill="tozeroy",
            fillcolor="rgba(139, 115, 85, 0.4)",
            line=dict(color="rgba(139, 115, 85, 0.8)", width=1),
            name="Ground (DTM)",
            hovertemplate="Distance: %{x:.2f} km<br>Ground: %{y:.1f} m MSL<extra></extra>",
        )
    )

    # Min AGL line — AGL above the peak terrain in the safety bubble disc
    fig.add_trace(
        go.Scatter(
            x=dist,
            y=min_band,
            line=dict(color="rgba(255, 165, 0, 0.6)", width=1, dash="dot"),
            name="Min AGL (bubble peak)",
            customdata=min_band - floor_ref,
            hovertemplate="Distance: %{x:.2f} km<br>Min AGL (bubble peak): %{customdata:.1f} m<extra></extra>",
        )
    )

    # Max AGL line — AGL above the minimum terrain in the camera range disc
    fig.add_trace(
        go.Scatter(
            x=dist,
            y=max_band,
            line=dict(color="rgba(255, 100, 100, 0.6)", width=1, dash="dot"),
            name="Max AGL (camera min)",
            customdata=max_band - ceil_ref,
            hovertemplate="Distance: %{x:.2f} km<br>Max AGL (camera min): %{customdata:.1f} m<extra></extra>",
        )
    )

    # Drone altitude
    agl_vals = altitudes - ground
    fig.add_trace(
        go.Scatter(
            x=dist,
            y=altitudes,
            line=dict(color="#1E90FF", width=2.5),
            name="Drone altitude (MSL)",
            customdata=list(zip(agl_vals, slope_labels)),
            hovertemplate=(
                "Distance: %{x:.2f} km<br>"
                "Altitude: %{y:.1f} m MSL<br>"
                "AGL: %{customdata[0]:.1f} m<br>"
                "Slope: %{customdata[1]}<extra></extra>"
            ),
        )
    )

    # POI scan area shading — pink background for every POI maneuver block
    if poi_scan_areas:
        for i, (start_m, end_m) in enumerate(poi_scan_areas):
            fig.add_vrect(
                x0=start_m / 1000.0,
                x1=end_m / 1000.0,
                fillcolor="rgba(255, 100, 180, 0.10)",
                layer="below",
                line_width=0,
                annotation_text=f"POI {i + 1}",
                annotation_position="top right",
                annotation=dict(font_size=9, font_color="rgba(255, 100, 180, 0.9)"),
            )

    # POI override zone shading — one rect per zone with custom AGL
    if poi_band_overrides:
        for start_m, end_m, poi_min, poi_max in poi_band_overrides:
            fig.add_vrect(
                x0=start_m / 1000.0,
                x1=end_m / 1000.0,
                fillcolor="rgba(255,200,0,0.07)",
                layer="below",
                line_width=0,
                annotation_text=f"↑{poi_max:.0f} m / ↓{poi_min:.0f} m AGL",
                annotation_position="top left",
                annotation=dict(font_size=9, font_color="rgba(255,200,0,0.8)"),
            )
            # Vertical boundary lines for the POI override zone
            fig.add_vline(
                x=start_m / 1000.0,
                line=dict(color="rgba(255,200,0,0.4)", width=1, dash="dot"),
            )
            fig.add_vline(
                x=end_m / 1000.0,
                line=dict(color="rgba(255,200,0,0.4)", width=1, dash="dot"),
            )

    # POI end markers
    if poi_distances:
        for i, pd in enumerate(poi_distances):
            fig.add_vline(
                x=pd / 1000.0,
                line=dict(color="#FF6347", width=1.5, dash="dash"),
                annotation_text=f"POI {i + 1}",
                annotation_position="top",
            )

    # Return-to-home marker
    if return_home_distance is not None:
        fig.add_vline(
            x=return_home_distance / 1000.0,
            line=dict(color="#9c27b0", width=1.5, dash="dashdot"),
            annotation_text="RTH",
            annotation_position="top left",
        )

    # Violation scatter markers — one trace per category
    if violation_points:
        _VIOL_STYLE = {
            "safety": ("#ff5252", "triangle-down", "Safety violation"),
            "product_poi": ("#ff9100", "triangle-up", "Product violation (scan)"),
            "product_route": ("#ffd600", "triangle-up", "Product violation (route)"),
        }
        grouped: dict[str, list[tuple[float, float, float]]] = {}
        for idx, cat in violation_points:
            if 0 <= idx < len(altitudes):
                # Safety violations are triggered by clearance above disc-peak terrain;
                # use that reference so the tooltip matches the triggering condition.
                if cat == "safety" and bubble_peak_terrain is not None:
                    agl = float(altitudes[idx] - bubble_peak_terrain[idx])
                else:
                    agl = float(altitudes[idx] - terrain_elevs[idx])
                grouped.setdefault(cat, []).append(
                    (float(cum_distances[idx]) / 1000.0, float(altitudes[idx]), agl)
                )
        for cat, pts in grouped.items():
            color, symbol, name = _VIOL_STYLE.get(cat, ("#ff9100", "triangle-up", "Violation"))
            xs, ys, agls = zip(*pts)
            fig.add_trace(
                go.Scatter(
                    x=list(xs),
                    y=list(ys),
                    mode="markers",
                    marker=dict(
                        color=color, symbol=symbol, size=10, line=dict(color="#fff", width=1)
                    ),
                    name=name,
                    customdata=list(agls),
                    hovertemplate=f"<b>{name}</b><br>Distance: %{{x:.2f}} km<br>AGL: %{{customdata:.1f}} m<extra></extra>",
                )
            )

    fig.update_layout(
        title="Altitude Profile",
        xaxis_title="Distance (km)",
        yaxis_title="Altitude (m MSL)",
        template="plotly_dark",
        legend=dict(orientation="h", yanchor="bottom", y=1.02, xanchor="right", x=1),
        margin=dict(l=60, r=30, t=60, b=50),
        autosize=True,
    )

    html_str = fig.to_html(full_html=True, include_plotlyjs="cdn", config={"responsive": True})
    return inject_dark_fullscreen_css(html_str)
