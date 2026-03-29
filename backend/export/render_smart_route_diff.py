"""
Smart Route diff visualisation: side-by-side comparison of the original and
laterally-optimised route on a Folium map, plus a Plotly offset chart.
Both panels are embedded in a single self-contained HTML page.
"""

from __future__ import annotations

import html as _html
import folium
import numpy as np
import plotly.graph_objects as go

from core.route import compute_cumulative_distances
from core.utm_utils import utm_to_latlon
from export.html_utils import srcdoc_escape


def render_smart_route_diff_html(
    original_pts: np.ndarray,
    optimised_pts: np.ndarray,
    altitudes: np.ndarray,
    zone_str: str,
    summary: str,
    terrain_saving_m: float | None = None,
) -> str:
    """Build a self-contained HTML page showing the Smart Route path diff.

    Top panel: Folium map with original (grey dashed) and optimised (colour)
    routes overlaid.
    Bottom panel: Plotly bar/line chart of the per-point lateral offset.

    Args:
        original_pts:  (N, 2) UTM array before lateral optimisation
        optimised_pts: (N, 2) UTM array after lateral optimisation
        altitudes:     (N,)  final MSL altitudes (for colouring the opt. path)
        zone_str:      UTM zone string
        summary:       human-readable result from _smart_route_lateral
    """
    # ── Lateral offsets ────────────────────────────────────────────────────────
    offsets_m = np.linalg.norm(optimised_pts - original_pts, axis=1)
    cum_dists_km = compute_cumulative_distances(original_pts) / 1000.0

    # ── Folium map ─────────────────────────────────────────────────────────────
    orig_ll  = [utm_to_latlon(float(p[0]), float(p[1]), zone_str) for p in original_pts]
    opt_ll   = [utm_to_latlon(float(p[0]), float(p[1]), zone_str) for p in optimised_pts]

    center_lat = float(np.mean([ll[0] for ll in orig_ll]))
    center_lon = float(np.mean([ll[1] for ll in orig_ll]))

    m = folium.Map(location=[center_lat, center_lon], zoom_start=14,
                   tiles="OpenStreetMap")

    # Original path — dashed grey
    folium.PolyLine(
        orig_ll,
        color="#6e7681",
        weight=3,
        opacity=0.7,
        dash_array="8 5",
        tooltip="Original route",
    ).add_to(m)

    # Optimised path — coloured by altitude
    alt_min = float(altitudes.min())
    alt_max = float(altitudes.max())
    alt_range = alt_max - alt_min if alt_max > alt_min else 1.0
    for i in range(len(opt_ll) - 1):
        t = (altitudes[i] - alt_min) / alt_range
        r = int(255 * t)
        b = int(255 * (1.0 - t))
        folium.PolyLine(
            [opt_ll[i], opt_ll[i + 1]],
            color=f"#{r:02x}00{b:02x}",
            weight=4,
            opacity=0.9,
            tooltip=folium.Tooltip(
                f"Offset: {offsets_m[i]:.1f} m<br>Alt: {altitudes[i]:.1f} m MSL",
                sticky=True,
            ),
        ).add_to(m)

    # Legend
    legend_html = """
    <div style="position:fixed;bottom:30px;right:10px;z-index:1000;
        background:rgba(13,17,23,0.88);border:1px solid #30363d;
        border-radius:8px;padding:10px 14px;font-family:monospace;font-size:12px;color:#c9d1d9;">
      <div style="font-weight:700;margin-bottom:6px;color:#1E90FF;">Smart Route Diff</div>
      <div><span style="color:#6e7681;">- - -</span> Original route</div>
      <div><span style="color:#1E90FF;">&#9473;</span> Optimised route</div>
    </div>
    """
    m.get_root().html.add_child(folium.Element(legend_html))

    lats = [ll[0] for ll in orig_ll]
    lons = [ll[1] for ll in orig_ll]
    m.fit_bounds([[min(lats), min(lons)], [max(lats), max(lons)]])

    map_html = m.get_root().render()

    # ── Plotly offset chart ────────────────────────────────────────────────────
    hover_text = [
        f"Distance: {d:.3f} km<br>Offset: {o:.1f} m"
        for d, o in zip(cum_dists_km, offsets_m)
    ]

    fig = go.Figure()

    # Filled area showing offset magnitude
    fig.add_trace(go.Scatter(
        x=cum_dists_km,
        y=offsets_m,
        mode="lines",
        fill="tozeroy",
        fillcolor="rgba(30,144,255,0.20)",
        line=dict(color="#1E90FF", width=1.5),
        hovertemplate="%{customdata}<extra></extra>",
        customdata=hover_text,
        name="Lateral offset",
    ))

    # Highlight the peak offset
    peak_idx = int(np.argmax(offsets_m))
    fig.add_trace(go.Scatter(
        x=[float(cum_dists_km[peak_idx])],
        y=[float(offsets_m[peak_idx])],
        mode="markers+text",
        marker=dict(color="#ff6347", size=10, symbol="circle"),
        text=[f"  peak {offsets_m[peak_idx]:.1f} m"],
        textposition="middle right",
        textfont=dict(color="#ff6347", size=11),
        hoverinfo="skip",
        showlegend=False,
    ))

    shifted_pct = float(np.mean(offsets_m > 0.5)) * 100
    subtitle_parts = [
        f"Shifted: {shifted_pct:.0f}% of path",
        f"Max: {offsets_m.max():.1f} m",
        f"Avg: {offsets_m.mean():.1f} m",
    ]
    if terrain_saving_m is not None:
        sign = "+" if terrain_saving_m >= 0 else ""
        subtitle_parts.append(f"Terrain variation saved: {sign}{terrain_saving_m:.1f} m")
    subtitle = "  |  ".join(subtitle_parts)
    fig.update_layout(
        title=dict(
            text=f"<b>Lateral Offset vs Distance</b><br>"
                 f"<span style='font-size:12px;color:#8b949e'>{subtitle}</span>",
            x=0.5, xanchor="center",
            font=dict(color="#c9d1d9", size=16),
        ),
        paper_bgcolor="#0d1117",
        plot_bgcolor="#0d1117",
        font=dict(color="#c9d1d9", size=12),
        xaxis=dict(
            title="Distance (km)", gridcolor="#21262d",
            linecolor="#30363d", zerolinecolor="#30363d",
        ),
        yaxis=dict(
            title="Lateral offset (m)", gridcolor="#21262d",
            linecolor="#30363d", rangemode="tozero",
        ),
        margin=dict(l=60, r=30, t=80, b=50),
        showlegend=False,
        hovermode="x unified",
    )

    chart_html = fig.to_html(full_html=True, include_plotlyjs=True)

    map_srcdoc = srcdoc_escape(map_html)
    chart_srcdoc = srcdoc_escape(chart_html)
    summary_escaped = _html.escape(summary)

    return f"""<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Smart Route Diff — FlyHigh</title>
<style>
*{{box-sizing:border-box;margin:0;padding:0}}
body{{background:#0d1117;font-family:Inter,system-ui,sans-serif;
     display:flex;flex-direction:column;height:100vh;overflow:hidden}}
.banner{{background:#161b22;border-bottom:1px solid #30363d;
         padding:8px 16px;display:flex;align-items:center;gap:12px;flex-shrink:0}}
.title{{color:#1E90FF;font-size:14px;font-weight:700;letter-spacing:.5px}}
.summary{{color:#8b949e;font-size:12px;font-family:monospace}}
.panels{{display:flex;flex-direction:column;flex:1;min-height:0}}
iframe{{border:none;width:100%;flex:1;min-height:0}}
</style>
</head>
<body>
<div class="banner">
  <span class="title">Smart Route Diff</span>
  <span class="summary">{summary_escaped}</span>
</div>
<div class="panels">
  <iframe srcdoc="{map_srcdoc}"></iframe>
  <iframe srcdoc="{chart_srcdoc}"></iframe>
</div>
</body>
</html>"""
