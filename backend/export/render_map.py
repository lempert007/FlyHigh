"""
2-D interactive Folium map: OSM tiles, route polyline, markers, safety bubbles.
Self-contained HTML output.
"""

from __future__ import annotations

import folium
import folium.plugins
import numpy as np

from core.utm_utils import utm_to_latlon
from models import FlightConfig


def render_map_html(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    zone_str: str,
    flight_cfg: FlightConfig,
    start_index: int = 0,
    waypoint_indices: list[int] | None = None,
    poi_indices: list[int] | None = None,
    poi_maneuver_radii: list[float] | None = None,
    violations: list[tuple[int, str, str]] | None = None,
    landing_index: int = -1,
) -> str:
    """Build a self-contained Folium HTML map.

    Features:
    - OSM base tiles
    - Route polyline coloured by altitude (low=blue → high=red)
    - Start (green), waypoint (blue), and POI (red) markers with altitude popups
    - Dashed safety-bubble circles around every waypoint and POI
    - Maneuver radius circles around POIs (when radii provided)
    - Violation points highlighted in orange

    Returns:
        Self-contained HTML string.
    """
    waypoint_indices = waypoint_indices or []
    poi_indices = poi_indices or []
    poi_maneuver_radii = poi_maneuver_radii or []
    violations = violations or []

    # Convert all route points to lat/lon
    latlons = [utm_to_latlon(float(p[0]), float(p[1]), zone_str) for p in utm_points]
    center_lat = np.mean([ll[0] for ll in latlons])
    center_lon = np.mean([ll[1] for ll in latlons])

    m = folium.Map(location=[center_lat, center_lon], zoom_start=14, tiles="OpenStreetMap")

    # Per-segment slope (signed m/m); last point copies second-to-last.
    seg_slopes = np.zeros(len(altitudes))
    if len(altitudes) > 1:
        dalt = np.diff(altitudes.astype(float))
        dxy = np.hypot(np.diff(utm_points[:, 0]), np.diff(utm_points[:, 1]))
        dxy = np.where(dxy < 1e-6, 1e-6, dxy)
        seg_slopes[:-1] = dalt / dxy
        seg_slopes[-1] = seg_slopes[-2]

    def _fmt_slope(s: float) -> str:
        if abs(s) < 1e-4:
            return "flat"
        sign = "↑" if s > 0 else "↓"
        return f"{sign} 1/{abs(1.0 / s):.0f}"

    # Colour route by altitude
    alt_min = float(altitudes.min())
    alt_max = float(altitudes.max())
    alt_range = alt_max - alt_min if alt_max > alt_min else 1.0

    for i in range(len(latlons) - 1):
        t = (altitudes[i] - alt_min) / alt_range
        r = int(255 * t)
        b = int(255 * (1.0 - t))
        colour = f"#{r:02x}00{b:02x}"
        lat_i, lon_i = latlons[i]
        folium.PolyLine(
            [latlons[i], latlons[i + 1]],
            color=colour,
            weight=4,
            opacity=0.85,
            tooltip=folium.Tooltip(
                f"Alt: {altitudes[i]:.1f} m MSL<br>"
                f"Lat: {lat_i:.6f}<br>"
                f"Lon: {lon_i:.6f}<br>"
                f"Slope: {_fmt_slope(seg_slopes[i])}",
                sticky=True,
            ),
        ).add_to(m)

    # Safety bubble circles around all waypoints and POIs
    key_indices = {start_index} | set(waypoint_indices) | set(poi_indices)
    for idx in key_indices:
        lat, lon = latlons[idx]
        folium.Circle(
            location=[lat, lon],
            radius=flight_cfg.point_radius_m,
            color="#ef5350",
            weight=1,
            dash_array="4 4",
            fill=False,
            tooltip=f"Safety radius {flight_cfg.point_radius_m:.0f} m",
        ).add_to(m)

    # Camera range circles (when enabled)
    if flight_cfg.max_surface_radius_m > 0:
        for idx in key_indices:
            lat, lon = latlons[idx]
            folium.Circle(
                location=[lat, lon],
                radius=flight_cfg.max_surface_radius_m,
                color="#ff9100",
                weight=1,
                dash_array="6 4",
                fill=False,
                tooltip=f"Camera range {flight_cfg.max_surface_radius_m:.0f} m",
            ).add_to(m)

    # Start marker
    lat, lon = latlons[start_index]
    folium.Marker(
        location=[lat, lon],
        icon=folium.Icon(color="green", icon="play", prefix="fa"),
        popup=folium.Popup(f"<b>Start</b><br>Alt: {altitudes[start_index]:.1f} m MSL", max_width=200),
        tooltip="Start",
    ).add_to(m)

    # Landing marker
    if 0 <= landing_index < len(latlons):
        lat, lon = latlons[landing_index]
        folium.Marker(
            location=[lat, lon],
            icon=folium.Icon(color="purple", icon="flag", prefix="fa"),
            popup=folium.Popup(f"<b>Landing</b><br>Alt: {altitudes[landing_index]:.1f} m MSL", max_width=200),
            tooltip="Landing",
        ).add_to(m)

    # Intermediate waypoint markers
    for j, idx in enumerate(waypoint_indices):
        lat, lon = latlons[idx]
        folium.Marker(
            location=[lat, lon],
            icon=folium.Icon(color="blue", icon=str(j + 1), prefix="fa"),
            popup=folium.Popup(f"<b>Waypoint {j + 1}</b><br>Alt: {altitudes[idx]:.1f} m MSL", max_width=200),
            tooltip=f"Waypoint {j + 1}",
        ).add_to(m)

    # POI markers
    for j, idx in enumerate(poi_indices):
        lat, lon = latlons[idx]
        folium.Marker(
            location=[lat, lon],
            icon=folium.Icon(color="red", icon="camera", prefix="fa"),
            popup=folium.Popup(f"<b>POI {j + 1}</b><br>Alt: {altitudes[idx]:.1f} m MSL", max_width=200),
            tooltip=f"POI {j + 1}",
        ).add_to(m)

    # Violation markers — colour and label by category
    _VIOL_STYLE = {
        "safety":        ("red",    "times-circle",        "Safety Violation"),
        "product_poi":   ("orange", "exclamation-triangle", "Product Violation — Scan Area"),
        "product_route": ("beige",  "exclamation",         "Product Violation — Transit"),
    }
    for idx, desc, category in (violations or []):
        lat, lon = latlons[idx]
        color, icon_name, label = _VIOL_STYLE.get(category, ("orange", "warning-sign", "Violation"))
        folium.Marker(
            location=[lat, lon],
            icon=folium.Icon(color=color, icon=icon_name, prefix="fa"),
            popup=folium.Popup(f"<b>{label}</b><br>{desc}", max_width=300),
            tooltip=f"{label}: {desc}",
        ).add_to(m)

    # Altitude colour legend
    legend_html = f"""
    <div style="
        position:fixed;bottom:30px;right:10px;z-index:1000;
        background:rgba(13,17,23,0.88);border:1px solid #30363d;
        border-radius:8px;padding:10px 14px;font-family:monospace;font-size:12px;color:#c9d1d9;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);min-width:140px;">
      <div style="font-weight:700;margin-bottom:6px;color:#1E90FF;letter-spacing:.5px;">Altitude</div>
      <div style="display:flex;align-items:center;gap:8px;">
        <div style="width:12px;height:80px;background:linear-gradient(to bottom,#ff0000,#0000ff);
                    border-radius:3px;flex-shrink:0;"></div>
        <div style="display:flex;flex-direction:column;justify-content:space-between;height:80px;">
          <span style="color:#ff6666;">{alt_max:.0f} m</span>
          <span style="color:#aaa;font-size:10px;">MSL</span>
          <span style="color:#6699ff;">{alt_min:.0f} m</span>
        </div>
      </div>
      <div style="margin-top:8px;border-top:1px solid #30363d;padding-top:6px;font-size:11px;color:#8b949e;">
        <span style="color:#4caf50;">&#9679;</span> Start &nbsp;
        <span style="color:#9c27b0;">&#9873;</span> Land<br>
        <span style="color:#2196f3;">&#9679;</span> Waypoint &nbsp;
        <span style="color:#f44336;">&#9679;</span> POI<br>
        <span style="color:#ef5350;">&#9675;</span> Hard zone &nbsp;
        <span style="color:orange;">&#9675;</span> Warn zone
      </div>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    # Ruler / distance measurement tool
    folium.plugins.MeasureControl(
        position="topleft",
        primary_length_unit="meters",
        secondary_length_unit="kilometers",
        primary_area_unit="sqmeters",
        secondary_area_unit="sqkilometers",
    ).add_to(m)

    # Fit map to route bounds
    if latlons:
        lats = [ll[0] for ll in latlons]
        lons = [ll[1] for ll in latlons]
        m.fit_bounds([[min(lats), min(lons)], [max(lats), max(lons)]])

    return m.get_root().render()
