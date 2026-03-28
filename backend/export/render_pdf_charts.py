"""
Matplotlib chart generators for the PDF mission report.

All functions return a base64-encoded PNG string suitable for embedding directly
in an HTML <img src="data:image/png;base64,..."> tag.
"""

from __future__ import annotations

import base64
import io
import math

import matplotlib
matplotlib.use("Agg")  # Non-interactive backend — must be set before importing pyplot
import matplotlib.pyplot as plt
import matplotlib.patheffects as pe
import numpy as np
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.patches import Circle, FancyArrowPatch

# ── Colour palette ──────────────────────────────────────────────────────────
_BG = "#0d1117"
_GRID = "#21262d"
_TEXT = "#c9d1d9"
_TEXT_DIM = "#8b949e"
_ACCENT = "#1E90FF"

# AGL clearance colour thresholds (metres)
_AGL_GOOD = 15.0   # above this → green
_AGL_WARN = 5.0    # above this → amber; below → red

_AGL_CMAP = LinearSegmentedColormap.from_list(
    "agl", ["#ff5252", "#ff9100", "#00e676"], N=256
)


def _fig_to_b64(fig: plt.Figure) -> str:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=150, bbox_inches="tight",
                facecolor=fig.get_facecolor())
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode()


def _setup_dark_axes(ax: plt.Axes) -> None:
    ax.set_facecolor(_BG)
    ax.tick_params(colors=_TEXT_DIM, labelsize=7)
    for spine in ax.spines.values():
        spine.set_edgecolor(_GRID)
    ax.xaxis.label.set_color(_TEXT_DIM)
    ax.yaxis.label.set_color(_TEXT_DIM)
    ax.title.set_color(_TEXT)


# ── 1. Route overview ────────────────────────────────────────────────────────

def route_overview_png(
    lats: np.ndarray,
    lons: np.ndarray,
    agl_arr: np.ndarray,
    min_agl: float,
    poi_indices: list[int],
    waypoint_indices: list[int],
    start_index: int,
    landing_index: int,
    point_radius_m: float,
) -> str:
    """Top-down route map coloured by AGL clearance."""
    fig, ax = plt.subplots(figsize=(7, 5))
    fig.patch.set_facecolor(_BG)
    _setup_dark_axes(ax)

    # Normalise AGL for colour mapping (clamp to [0, 3×min_agl])
    agl_clamp = np.clip(agl_arr, 0, max(3 * min_agl, 1))
    vmax = float(np.nanpercentile(agl_clamp, 95)) if agl_clamp.size > 0 else max(3 * min_agl, 1)
    norm = plt.Normalize(vmin=0, vmax=vmax)

    sc = ax.scatter(lons, lats, c=agl_clamp, cmap=_AGL_CMAP, norm=norm,
                    s=2, linewidths=0, zorder=2, rasterized=True)

    # Start marker
    ax.plot(lons[start_index], lats[start_index], marker="^", color="#00e676",
            markersize=10, zorder=5, label="Start")
    # Landing marker
    if 0 <= landing_index < len(lats):
        ax.plot(lons[landing_index], lats[landing_index], marker="s", color="#9c27b0",
                markersize=8, zorder=5, label="Landing")
    # POI markers
    for j, idx in enumerate(poi_indices):
        ax.plot(lons[idx], lats[idx], marker="*", color="#ff9100",
                markersize=12, zorder=5,
                label="POI" if j == 0 else None)
        ax.annotate(f"P{j+1}", (lons[idx], lats[idx]),
                    textcoords="offset points", xytext=(6, 4),
                    fontsize=7, color="#ff9100", zorder=6)
    # Waypoint markers
    for idx in waypoint_indices:
        ax.plot(lons[idx], lats[idx], marker="D", color=_ACCENT,
                markersize=5, zorder=4)

    cb = fig.colorbar(sc, ax=ax, pad=0.02, shrink=0.8)
    cb.set_label("AGL clearance (m)", color=_TEXT_DIM, fontsize=8)
    cb.ax.yaxis.set_tick_params(color=_TEXT_DIM, labelsize=7)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=_TEXT_DIM)

    ax.set_xlabel("Longitude", fontsize=8)
    ax.set_ylabel("Latitude", fontsize=8)
    ax.set_title("Route Overview — AGL Clearance", fontsize=10, pad=8)
    ax.legend(loc="upper right", fontsize=7, facecolor=_BG,
              edgecolor=_GRID, labelcolor=_TEXT_DIM)
    ax.grid(True, color=_GRID, linewidth=0.5, alpha=0.6)

    fig.tight_layout()
    return _fig_to_b64(fig)


# ── 2. AGL heat map ─────────────────────────────────────────────────────────

def agl_heatmap_png(
    lats: np.ndarray,
    lons: np.ndarray,
    agl_arr: np.ndarray,
    min_agl: float,
) -> str:
    """Route scatter coloured strictly by AGL value with threshold annotations."""
    fig, ax = plt.subplots(figsize=(7, 4.5))
    fig.patch.set_facecolor(_BG)
    _setup_dark_axes(ax)

    vmax = float(np.nanpercentile(agl_arr, 98)) if agl_arr.size > 0 else max(3 * min_agl, 1)
    norm = plt.Normalize(vmin=0, vmax=vmax)
    sc = ax.scatter(lons, lats, c=agl_arr, cmap=_AGL_CMAP, norm=norm,
                    s=3, linewidths=0, zorder=2, rasterized=True)

    cb = fig.colorbar(sc, ax=ax, pad=0.02, shrink=0.8)
    cb.set_label("AGL clearance (m)", color=_TEXT_DIM, fontsize=8)
    cb.ax.yaxis.set_tick_params(color=_TEXT_DIM, labelsize=7)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=_TEXT_DIM)

    # Stats annotation
    valid = agl_arr[np.isfinite(agl_arr)]
    if valid.size > 0:
        pct_tight = 100.0 * np.sum(valid < min_agl * 1.2) / valid.size
        pct_warn = 100.0 * np.sum(valid < _AGL_WARN) / valid.size
        stats_txt = (
            f"Min: {valid.min():.1f} m    Mean: {valid.mean():.1f} m\n"
            f"Below {min_agl*1.2:.0f} m (tight): {pct_tight:.1f}%    "
            f"Below {_AGL_WARN:.0f} m (critical): {pct_warn:.1f}%"
        )
        ax.text(0.02, 0.03, stats_txt, transform=ax.transAxes,
                fontsize=7, color=_TEXT_DIM, va="bottom",
                bbox=dict(facecolor=_BG, edgecolor=_GRID, boxstyle="round,pad=0.3"))

    ax.set_xlabel("Longitude", fontsize=8)
    ax.set_ylabel("Latitude", fontsize=8)
    ax.set_title("AGL Clearance Heat Map", fontsize=10, pad=8)
    ax.grid(True, color=_GRID, linewidth=0.5, alpha=0.6)

    fig.tight_layout()
    return _fig_to_b64(fig)


# ── 3. Terrain elevation map ─────────────────────────────────────────────────

def terrain_map_png(
    terrain_grid: np.ndarray,
    terrain_grid_lons: np.ndarray,
    terrain_grid_lats: np.ndarray,
    lats: np.ndarray,
    lons: np.ndarray,
    poi_indices: list[int],
    start_index: int,
    landing_index: int,
) -> str:
    """False-colour terrain elevation map with route overlaid."""
    fig, ax = plt.subplots(figsize=(7, 5))
    fig.patch.set_facecolor(_BG)
    _setup_dark_axes(ax)

    lon_min, lon_max = terrain_grid_lons.min(), terrain_grid_lons.max()
    lat_min, lat_max = terrain_grid_lats.min(), terrain_grid_lats.max()

    im = ax.imshow(
        terrain_grid,
        origin="lower",
        extent=[lon_min, lon_max, lat_min, lat_max],
        cmap="terrain",
        aspect="auto",
        zorder=1,
    )

    cb = fig.colorbar(im, ax=ax, pad=0.02, shrink=0.8)
    cb.set_label("Elevation (m MSL)", color=_TEXT_DIM, fontsize=8)
    cb.ax.yaxis.set_tick_params(color=_TEXT_DIM, labelsize=7)
    plt.setp(cb.ax.yaxis.get_ticklabels(), color=_TEXT_DIM)

    # Route line
    ax.plot(lons, lats, color="white", linewidth=1.2, alpha=0.85, zorder=3,
            path_effects=[pe.Stroke(linewidth=2.5, foreground="black", alpha=0.5),
                          pe.Normal()])

    # Markers
    ax.plot(lons[start_index], lats[start_index], "^", color="#00e676",
            markersize=9, zorder=5, label="Start")
    if 0 <= landing_index < len(lats):
        ax.plot(lons[landing_index], lats[landing_index], "s", color="#9c27b0",
                markersize=7, zorder=5, label="Landing")
    for j, idx in enumerate(poi_indices):
        ax.plot(lons[idx], lats[idx], "*", color="#ff9100",
                markersize=11, zorder=5, label="POI" if j == 0 else None)

    ax.set_xlim(lon_min, lon_max)
    ax.set_ylim(lat_min, lat_max)
    ax.set_xlabel("Longitude", fontsize=8)
    ax.set_ylabel("Latitude", fontsize=8)
    ax.set_title("Terrain Elevation Map", fontsize=10, pad=8)
    ax.legend(loc="upper right", fontsize=7, facecolor=_BG,
              edgecolor=_GRID, labelcolor=_TEXT_DIM)
    ax.grid(True, color="white", linewidth=0.3, alpha=0.3)

    fig.tight_layout()
    return _fig_to_b64(fig)


# ── 4. Altitude profile ──────────────────────────────────────────────────────

def altitude_profile_png(
    cum_dists: np.ndarray,
    final_alts: np.ndarray,
    terrain_elevs: np.ndarray,
    min_agl: float,
    max_agl: float,
    poi_distances: list[float],
    landing_dist: float | None = None,
) -> str:
    """Dual-line altitude profile: drone MSL vs terrain MSL with AGL band."""
    fig, ax = plt.subplots(figsize=(10, 4))
    fig.patch.set_facecolor(_BG)
    _setup_dark_axes(ax)

    dist_km = cum_dists / 1000.0

    # Terrain fill
    ax.fill_between(dist_km, terrain_elevs, alpha=0.4,
                    color="#8b6914", label="Terrain", zorder=1)
    ax.plot(dist_km, terrain_elevs, color="#c9a227", linewidth=1.0, zorder=2)

    # AGL band shading (min_agl and max_agl above terrain)
    ax.fill_between(dist_km, terrain_elevs + min_agl, terrain_elevs + max_agl,
                    alpha=0.12, color="#00e676", zorder=2, label=f"AGL band ({min_agl:.0f}–{max_agl:.0f} m)")

    # Drone altitude line
    ax.plot(dist_km, final_alts, color=_ACCENT, linewidth=1.8,
            label="Drone (MSL)", zorder=4)
    ax.fill_between(dist_km, terrain_elevs, final_alts,
                    alpha=0.08, color=_ACCENT, zorder=3)

    # Min AGL threshold
    ax.plot(dist_km, terrain_elevs + min_agl, color="#ff9100", linewidth=0.8,
            linestyle="--", alpha=0.7, label=f"Min AGL ({min_agl:.0f} m)", zorder=3)

    # POI vertical lines
    for j, d in enumerate(poi_distances):
        dk = d / 1000.0
        ax.axvline(dk, color="#ff9100", linewidth=0.8, linestyle=":", alpha=0.7, zorder=3)
        ax.text(dk, ax.get_ylim()[1] if ax.get_ylim()[1] != 0 else final_alts.max(),
                f" P{j+1}", fontsize=6, color="#ff9100", va="top", zorder=5)

    # Landing line
    if landing_dist is not None:
        ax.axvline(landing_dist / 1000.0, color="#9c27b0", linewidth=0.8,
                   linestyle="--", alpha=0.7, label="Landing", zorder=3)

    ax.set_xlabel("Distance (km)", fontsize=8)
    ax.set_ylabel("Altitude (m MSL)", fontsize=8)
    ax.set_title("Altitude Profile", fontsize=10, pad=8)
    ax.legend(loc="upper right", fontsize=7, facecolor=_BG,
              edgecolor=_GRID, labelcolor=_TEXT_DIM, ncol=2)
    ax.grid(True, color=_GRID, linewidth=0.5, alpha=0.5)
    ax.set_xlim(dist_km[0], dist_km[-1])

    fig.tight_layout()
    return _fig_to_b64(fig)
