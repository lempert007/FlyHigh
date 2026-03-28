import type { LatLon } from "../types/mission";

type PointLike = LatLon | [number, number];

function toLat(p: PointLike): number {
  return Array.isArray(p) ? p[0] : p.lat;
}
function toLon(p: PointLike): number {
  return Array.isArray(p) ? p[1] : p.lon;
}

/** Haversine distance in metres. Accepts [lat,lon] arrays or {lat,lon} objects. */
export function haversineM(a: PointLike, b: PointLike): number {
  const R = 6_371_000;
  const lat1 = (toLat(a) * Math.PI) / 180;
  const lat2 = (toLat(b) * Math.PI) / 180;
  const dLat = ((toLat(b) - toLat(a)) * Math.PI) / 180;
  const dLon = ((toLon(b) - toLon(a)) * Math.PI) / 180;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(x));
}

/** Format a distance in metres as a human-readable string. */
export function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/** Format seconds as "Xm Ys". */
export function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

/** Format square metres: km² for large areas, ha for medium, m² for small. */
export function formatArea(m2: number): string {
  if (m2 >= 1_000_000) return `${(m2 / 1_000_000).toFixed(2)} km²`;
  if (m2 >= 10_000) return `${(m2 / 10_000).toFixed(2)} ha`;
  return `${Math.round(m2).toLocaleString()} m²`;
}

/** Format an ISO timestamp as a human-readable relative date. */
export function relativeDate(iso: string): string {
  if (!iso) return "";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Map a battery percentage to a status color string. */
export function getBatteryColor(
  pct: number | null | undefined,
  warnPct = 90,
  errorPct = 100
): string {
  if (pct == null) return "text.secondary";
  if (pct > errorPct) return "#ff5252";
  if (pct > warnPct) return "#ff9100";
  return "#00e676";
}

/** Rough client-side power estimate (W) for energy preview. */
export function estimatePowerW(speedMs: number, weightKg: number): number {
  const GRAVITY = 9.81;
  const AIR_DENSITY = 1.225;
  const HOVER_EFF = 0.7;
  const hoverPower = Math.sqrt((weightKg * GRAVITY) ** 3 / (2 * AIR_DENSITY * 0.09)) / HOVER_EFF;
  const forwardFactor = 1 + (speedMs / 15) ** 2 * 0.3;
  return hoverPower * forwardFactor;
}
