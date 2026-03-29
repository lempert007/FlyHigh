"""
GeoTIFF loading and UTM terrain interpolation.

The public surface is the TerrainIndex class — all callers pass LatLon coordinates;
UTM conversion is fully internal. The module-level helpers (load_tiff, extract_file_info)
are unchanged and still used by the upload API.
"""

from __future__ import annotations

import logging
import math
import os
from typing import Callable, Literal

import numpy as np
import rasterio
import rasterio.crs
import rasterio.warp
import utm
from scipy.interpolate import RegularGridInterpolator

import config
from core.types import LatLon, TerrainProfile, TerrainSample
from models import FileInfo

logger = logging.getLogger(__name__)


class TerrainIndex:
    """Terrain elevation query object backed by a UTM-projected raster.

    All public methods accept WGS84 LatLon inputs; UTM conversion is internal.
    """

    def __init__(
        self,
        interpolator: RegularGridInterpolator,
        zone_str: str,
        resolution_m: float,
    ) -> None:
        self._interp = interpolator
        self.zone_str = zone_str
        self.resolution_m = resolution_m

    # ── Internal UTM helpers ──────────────────────────────────────────────────

    def _to_utm(self, point: LatLon) -> tuple[float, float]:
        """Convert a LatLon to (easting, northing) in this index's UTM zone."""
        e, n, _, _ = utm.from_latlon(point.lat, point.lon)
        return e, n

    def _sample_utm(self, utm_points: np.ndarray) -> np.ndarray:
        """Query the interpolator at (N,2) [easting, northing] points."""
        query = np.column_stack(
            [utm_points[:, 1], utm_points[:, 0]]
        )  # (N, easting)→(northing, easting)
        return self._interp(query)

    # ── Public API ────────────────────────────────────────────────────────────

    def elevation_at(self, point: LatLon) -> float:
        """Return terrain MSL elevation at a geographic point.

        NaN is returned (not raised) for points outside the raster extent —
        callers must decide how to handle missing data.
        """
        e, n = self._to_utm(point)
        result = self._sample_utm(np.array([[e, n]]))
        return float(result[0])

    def sample_leg(self, start: LatLon, end: LatLon, spacing_m: float) -> TerrainProfile:
        """Densely sample terrain elevations along the straight segment start→end.

        Returns one sample at distance 0, then every spacing_m, then one at the
        full leg length. This is the foundation for all leg-level terrain analysis.
        """
        se, sn = self._to_utm(start)
        ee, en = self._to_utm(end)

        de = ee - se
        dn = en - sn
        leg_len = math.hypot(de, dn)

        if leg_len < 1e-6:
            elev = float(self._sample_utm(np.array([[se, sn]]))[0])
            if math.isnan(elev):
                elev = 0.0
            return TerrainProfile(samples=[TerrainSample(distance_m=0.0, elevation_msl=elev)])

        n_pts = max(2, math.ceil(leg_len / spacing_m) + 1)
        dists = np.linspace(0.0, leg_len, n_pts)

        east_vals = se + de * (dists / leg_len)
        north_vals = sn + dn * (dists / leg_len)
        utm_pts = np.column_stack([east_vals, north_vals])
        elev_vals = self._sample_utm(utm_pts)

        # Replace NaN with safe fallback: max valid elevation + max_agl
        nan_mask = np.isnan(elev_vals)
        if nan_mask.any():
            valid = elev_vals[~nan_mask]
            safe_fill = float(valid.max()) + config.DEFAULT_MAX_AGL_M if len(valid) > 0 else config.DEFAULT_MAX_AGL_M
            elev_vals = np.where(nan_mask, safe_fill, elev_vals)

        samples = [
            TerrainSample(distance_m=float(d), elevation_msl=float(e))
            for d, e in zip(dists, elev_vals)
        ]
        return TerrainProfile(samples=samples)

    def peak_elevation_msl(self, start: LatLon, end: LatLon, spacing_m: float) -> float:
        """Return the maximum terrain MSL elevation along the segment."""
        return self.sample_leg(start, end, spacing_m).peak_elevation_msl()

    def disc_peak_at(self, point: LatLon, radius_m: float) -> float:
        """Peak terrain elevation within a disc of radius_m centered at point.

        Uses the same multi-ring sampling geometry as the safety checker
        (BUBBLE_RING_COUNT concentric rings + center), so planned altitudes always
        satisfy the safety check.  Single-ring sampling caused violations when
        terrain features existed only within inner rings.
        Returns NaN only when all samples are outside the raster.
        """
        e, n = self._to_utm(point)
        n_az = config.BUBBLE_SAMPLE_COUNT
        n_rings = config.BUBBLE_RING_COUNT
        angles = np.linspace(0.0, 2 * np.pi, n_az, endpoint=False)
        ring_radii = np.linspace(radius_m / n_rings, radius_m, n_rings)
        ring_e = (e + ring_radii[:, np.newaxis] * np.cos(angles)).ravel()
        ring_n = (n + ring_radii[:, np.newaxis] * np.sin(angles)).ravel()
        all_e = np.concatenate([[e], ring_e])
        all_n = np.concatenate([[n], ring_n])
        pts = np.column_stack([all_e, all_n])
        elev = self._sample_utm(pts)
        return float(np.nanmax(elev)) if not np.all(np.isnan(elev)) else math.nan

    def sample_ribbon(
        self,
        start: LatLon,
        end: LatLon,
        spacing_m: float,
        half_width_m: float,
    ) -> TerrainProfile:
        """Sample terrain along a ribbon, returning the max elevation at each sample position.

        Samples 10 directions at each position: 7 lateral (center, ±R/3, ±2R/3, ±R
        perpendicular) plus 3 forward (R/3, 2R/3, R ahead along the path direction).
        The lateral scales mirror the safety checker's 3-ring disc structure so the
        ribbon floor is consistent with what the safety checker enforces.  The forward
        samples are critical for hill approaches — they capture terrain the safety-disc
        "sees ahead" before the drone arrives, so ramp pins are inserted in time.
        """
        se, sn = self._to_utm(start)
        ee, en = self._to_utm(end)
        de, dn = ee - se, en - sn
        leg_len = math.hypot(de, dn)

        if leg_len < 1e-6 or half_width_m < 1e-6:
            return self.sample_leg(start, end, spacing_m)

        n_pts = max(2, math.ceil(leg_len / spacing_m) + 1)
        dists = np.linspace(0.0, leg_len, n_pts)
        ts = dists / leg_len
        center_e = se + ts * de
        center_n = sn + ts * dn

        # Perpendicular unit vector (rotate 90°)
        perp_e = -dn / leg_len
        perp_n = de / leg_len
        # Forward unit vector (along path)
        fwd_e = de / leg_len
        fwd_n = dn / leg_len

        # (perp_scale, fwd_scale) — each multiplied by half_width_m.
        # Lateral scales match the safety checker's 3-ring structure (R/3, 2R/3, R)
        # so the ribbon floor is consistent with what the safety checker enforces.
        directions = [
            (0.0, 0.0),          # center
            (1.0, 0.0),          # right R
            (-1.0, 0.0),         # left R
            (2 / 3, 0.0),        # right 2R/3
            (-2 / 3, 0.0),       # left 2R/3
            (1 / 3, 0.0),        # right R/3  ← inner ring, matches safety checker
            (-1 / 3, 0.0),       # left R/3
            (0.0, 1.0),          # ahead R  ← catches hill-approach violations
            (0.0, 2 / 3),        # ahead 2R/3
            (0.0, 1 / 3),        # ahead R/3
        ]
        all_pts = []
        for ps, fs in directions:
            all_pts.append(
                np.column_stack(
                    [
                        center_e + ps * perp_e * half_width_m + fs * fwd_e * half_width_m,
                        center_n + ps * perp_n * half_width_m + fs * fwd_n * half_width_m,
                    ]
                )
            )
        pts = np.vstack(all_pts)  # (10 * n_pts, 2)
        all_elevs = self._sample_utm(pts)  # (10 * n_pts,)

        elev_mat = all_elevs.reshape(len(directions), n_pts)
        elev_vals = np.nanmax(elev_mat, axis=0)

        nan_mask = np.isnan(elev_vals)
        if nan_mask.any():
            valid = elev_vals[~nan_mask]
            safe_fill = float(valid.max()) + config.DEFAULT_MAX_AGL_M if len(valid) > 0 else 0.0
            elev_vals = np.where(nan_mask, safe_fill, elev_vals)

        return TerrainProfile(
            samples=[
                TerrainSample(distance_m=float(d), elevation_msl=float(e))
                for d, e in zip(dists, elev_vals)
            ]
        )

    def sample_ribbon_peak(
        self,
        start: LatLon,
        end: LatLon,
        spacing_m: float,
        half_width_m: float,
    ) -> float:
        """Peak terrain elevation over the ribbon of half_width_m around start→end.

        Delegates to sample_ribbon() so both methods share identical sampling geometry.
        Returns the global nanmax, or NaN when all samples fall outside the raster.
        """
        profile = self.sample_ribbon(start, end, spacing_m, half_width_m)
        if not profile.samples:
            return math.nan
        peak = max(s.elevation_msl for s in profile.samples)
        return peak if not math.isnan(peak) else math.nan

    def sample_points(self, utm_points: np.ndarray) -> np.ndarray:
        """Sample terrain elevation at an array of (N, 2) UTM points.

        Returns an (N,) array of MSL elevations (NaN for out-of-bounds points).
        """
        return sample_elevation(self._interp, utm_points)


# ── Factory ───────────────────────────────────────────────────────────────────


def build_terrain_index(
    dataset: rasterio.DatasetReader,
    on_reproject: Callable[[], None] | None = None,
    on_interpolate: Callable[[], None] | None = None,
) -> TerrainIndex:
    """Reproject a raster to its natural UTM zone and build a TerrainIndex.

    Preserves bilinear resampling and no-data→NaN behaviour.
    on_reproject: called just before the (slow) rasterio reproject.
    on_interpolate: called just before building the RegularGridInterpolator.
    """
    interpolator, zone_str, resolution_m = reproject_to_utm(dataset, on_reproject, on_interpolate)
    return TerrainIndex(interpolator, zone_str, resolution_m)


# ── Low-level raster helpers (kept for backward compatibility) ─────────────────


def load_tiff(path: str) -> rasterio.DatasetReader:
    """Open a GeoTIFF and return its DatasetReader."""
    try:
        ds = rasterio.open(path)
    except Exception as exc:
        raise RuntimeError(f"Cannot open GeoTIFF at {path!r}: {exc}") from exc
    if ds.count < 1:
        ds.close()
        raise RuntimeError(f"GeoTIFF at {path!r} has no bands")
    return ds


def reproject_to_utm(
    ds: rasterio.DatasetReader,
    on_reproject: Callable[[], None] | None = None,
    on_interpolate: Callable[[], None] | None = None,
) -> tuple[RegularGridInterpolator, str, float]:
    """Reproject a raster to its natural UTM zone and build a terrain interpolator.

    Returns:
        interpolator: RegularGridInterpolator in (northing, easting) order
        zone_str: UTM zone string e.g. "32N"
        resolution_m: conservative pixel size (max of x/y pixel dimensions)
    """
    centre_lon = (ds.bounds.left + ds.bounds.right) / 2
    centre_lat = (ds.bounds.top + ds.bounds.bottom) / 2

    src_crs = ds.crs
    if not src_crs.is_geographic:
        xs, ys = rasterio.warp.transform(src_crs, "EPSG:4326", [centre_lon], [centre_lat])
        centre_lon, centre_lat = xs[0], ys[0]

    _, _, zone_number, zone_letter = utm.from_latlon(centre_lat, centre_lon)
    zone_str = f"{zone_number}{zone_letter}"
    northern = zone_letter >= "N"
    utm_epsg = 32600 + zone_number if northern else 32700 + zone_number
    dst_crs = rasterio.crs.CRS.from_epsg(utm_epsg)

    transform, width, height = rasterio.warp.calculate_default_transform(
        src_crs,
        dst_crs,
        ds.width,
        ds.height,
        left=ds.bounds.left,
        bottom=ds.bounds.bottom,
        right=ds.bounds.right,
        top=ds.bounds.top,
    )

    if on_reproject:
        on_reproject()
    logger.info("Reprojecting CRS -> UTM coordinate frame")
    destination = np.empty((height, width), dtype=np.float64)
    nodata_val = ds.nodata if ds.nodata is not None else config.NODATA_FILL
    rasterio.warp.reproject(
        source=rasterio.band(ds, 1),
        destination=destination,
        src_transform=ds.transform,
        src_crs=src_crs,
        dst_transform=transform,
        dst_crs=dst_crs,
        resampling=rasterio.warp.Resampling.bilinear,
        src_nodata=ds.nodata,
        dst_nodata=nodata_val,
    )

    if ds.nodata is not None:
        destination[destination == ds.nodata] = np.nan

    pixel_size_e = abs(transform.a)
    pixel_size_n = abs(transform.e)
    origin_e = transform.c + pixel_size_e * 0.5
    origin_n = transform.f - pixel_size_n * 0.5

    e_axis = origin_e + np.arange(width) * pixel_size_e
    n_axis = origin_n - np.arange(height) * pixel_size_n
    n_axis_sorted = n_axis[::-1]
    elev_grid = destination[::-1, :]

    if on_interpolate:
        on_interpolate()
    logger.info("Building terrain interpolator")
    interpolator = RegularGridInterpolator(
        (n_axis_sorted, e_axis),
        elev_grid,
        method="linear",
        bounds_error=False,
        fill_value=np.nan,
    )
    resolution_m = float(max(abs(transform.a), abs(transform.e)))
    return interpolator, zone_str, resolution_m


def sample_elevation(
    interpolator: RegularGridInterpolator,
    utm_points: np.ndarray,
) -> np.ndarray:
    """Sample elevation values at N UTM points (shape N,2 [easting, northing])."""
    query = np.column_stack([utm_points[:, 1], utm_points[:, 0]])
    return interpolator(query)


def extract_file_info(
    ds: rasterio.DatasetReader,
    inferred_type: Literal["DSM", "DTM", "unknown"],
) -> FileInfo:
    """Build a FileInfo from an open rasterio DatasetReader."""
    src_crs = ds.crs
    bounds = ds.bounds

    if not src_crs.is_geographic:
        lons, lats = rasterio.warp.transform(
            src_crs,
            "EPSG:4326",
            [bounds.left, bounds.right, bounds.left, bounds.right],
            [bounds.bottom, bounds.bottom, bounds.top, bounds.top],
        )
        west = min(lons)
        east = max(lons)
        south = min(lats)
        north = max(lats)
    else:
        west, south, east, north = bounds.left, bounds.bottom, bounds.right, bounds.top

    res_x, res_y = ds.res
    if src_crs.is_geographic:
        centre_lat = (south + north) / 2
        res_m = (res_x + res_y) / 2 * 111_320.0 * abs(np.cos(np.radians(centre_lat)))
    else:
        res_m = (res_x + res_y) / 2

    return FileInfo(
        name=os.path.basename(ds.name),
        resolution_m=round(res_m, 2),
        bbox=(west, south, east, north),
        crs=src_crs.to_string(),
        inferred_type=inferred_type,
    )
