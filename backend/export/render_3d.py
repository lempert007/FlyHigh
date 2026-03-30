"""
3-D terrain + route visualisation: self-contained Plotly HTML.
"""

from __future__ import annotations

import numpy as np
import plotly.graph_objects as go

import config
from core.terrain import TerrainIndex
from export.html_utils import inject_dark_fullscreen_css


def render_3d_html(
    utm_points: np.ndarray,
    altitudes: np.ndarray,
    dsm_index: TerrainIndex,
    zone_str: str,
    poi_indices: list[int] | None = None,
) -> str:
    """Build a self-contained 3-D Plotly HTML with terrain surface and flight path.

    Args:
        utm_points: (N, 2) [easting, northing]
        altitudes: (N,) MSL altitudes
        dsm_index: TerrainIndex for the DSM surface
        zone_str: UTM zone string
        poi_indices: point indices that are POI centres (highlighted with red markers)

    Returns:
        Self-contained HTML string.
    """
    fig = go.Figure()

    # Compute bounding box for the surface grid (padded)
    e_min = utm_points[:, 0].min() - config.DEM_PADDING_M
    e_max = utm_points[:, 0].max() + config.DEM_PADDING_M
    n_min = utm_points[:, 1].min() - config.DEM_PADDING_M
    n_max = utm_points[:, 1].max() + config.DEM_PADDING_M

    e_grid = np.linspace(e_min, e_max, config.DEM_GRID_SIZE)
    n_grid = np.linspace(n_min, n_max, config.DEM_GRID_SIZE)
    EE, NN = np.meshgrid(e_grid, n_grid)

    grid_pts = np.column_stack([EE.ravel(), NN.ravel()])  # (N, 2) [easting, northing]
    elev_flat = dsm_index.sample_points(grid_pts)
    elev_surface = elev_flat.reshape(config.DEM_GRID_SIZE, config.DEM_GRID_SIZE)

    # Replace NaN with minimum valid elevation
    valid_elev = elev_surface[~np.isnan(elev_surface)]
    fill_val = float(valid_elev.min()) if valid_elev.size > 0 else 0.0
    elev_surface = np.where(np.isnan(elev_surface), fill_val, elev_surface)

    # Terrain surface
    fig.add_trace(
        go.Surface(
            x=EE,
            y=NN,
            z=elev_surface,
            colorscale="earth",
            opacity=0.85,
            showscale=True,
            colorbar=dict(title="Elev (m)", x=0.0),
            name="Terrain (DSM)",
            hovertemplate="E: %{x:.0f} m<br>N: %{y:.0f} m<br>Elev: %{z:.1f} m<extra>DSM</extra>",
        )
    )

    # Flight path
    fig.add_trace(
        go.Scatter3d(
            x=utm_points[:, 0],
            y=utm_points[:, 1],
            z=altitudes,
            mode="lines",
            line=dict(color="royalblue", width=4),
            name="Flight path",
        )
    )

    # Start marker
    fig.add_trace(
        go.Scatter3d(
            x=[utm_points[0, 0]],
            y=[utm_points[0, 1]],
            z=[altitudes[0]],
            mode="markers",
            marker=dict(size=8, color="limegreen", symbol="diamond"),
            name="Start",
        )
    )

    # POI markers
    if poi_indices:
        for idx in poi_indices:
            fig.add_trace(
                go.Scatter3d(
                    x=[utm_points[idx, 0]],
                    y=[utm_points[idx, 1]],
                    z=[altitudes[idx]],
                    mode="markers",
                    marker=dict(size=8, color="red", symbol="circle"),
                    name=f"POI @ pt {idx}",
                )
            )

    fig.update_layout(
        title="FlyHigh — 3D Route",
        scene=dict(
            xaxis_title="Easting (m)",
            yaxis_title="Northing (m)",
            zaxis_title="Altitude (m MSL)",
            aspectmode="manual",
            aspectratio=dict(x=1, y=1, z=0.3),
        ),
        template="plotly_dark",
        margin=dict(l=0, r=0, t=40, b=0),
        autosize=True,
    )

    html_str = fig.to_html(full_html=True, include_plotlyjs=True, config={"responsive": True})
    return inject_dark_fullscreen_css(html_str)
