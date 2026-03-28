import JSZip from "jszip";
import type { LatLon, Poi, FlightConfig, UploadResult, PlanMeta, AvailableTiff, TiffSelection, MissionSummary, MissionState, MissionStatus, PresetItem, DashboardStats, AppSettings } from "../types/mission";

interface PydanticError { loc?: string[]; msg: string }
interface ErrorBody { detail?: string | PydanticError[] }

function parseErrorDetail(data: ErrorBody | null, fallback: string): string {
  if (!data) return fallback;
  const detail = Array.isArray(data.detail)
    ? data.detail.map((e) => `${e.loc?.slice(1).join(".")}: ${e.msg}`).join("\n")
    : data.detail;
  return detail || fallback;
}

/** Extract meta.json from a ZIP blob returned by the plan/altitude-edit endpoints. */
async function extractMetaFromZip(blob: Blob): Promise<PlanMeta | null> {
  try {
    const zip = await JSZip.loadAsync(blob);
    const metaFile = zip.file("meta.json");
    if (!metaFile) return null;
    return JSON.parse(await metaFile.async("text")) as PlanMeta;
  } catch {
    return null;
  }
}

/** Fetch the list of GeoTIFF files available in the server-side library. */
export async function fetchAvailableTiffs(): Promise<AvailableTiff[]> {
  const res = await fetch("/tiffs");
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to load TIFF library: ${res.status}`));
  }
  return res.json() as Promise<AvailableTiff[]>;
}

/** Activate selected library files into a new session. */
export async function activateTiffs(selections: TiffSelection[]): Promise<UploadResult> {
  const res = await fetch("/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selections }),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to activate terrain: ${res.status}`));
  }
  return res.json() as Promise<UploadResult>;
}

/** Cancels any in-flight planRoute request when a new one starts. */
let _planAbortController: AbortController | null = null;

/** Plan a route and get back the ZIP blob + metadata. Aborts after 5 minutes.
 * Automatically cancels any previous in-flight plan request. */
export async function planRoute(
  sessionId: string,
  routeRequest: Record<string, unknown>,
): Promise<{ blob: Blob; meta: PlanMeta | null }> {
  // Cancel previous request if still pending
  _planAbortController?.abort();
  const controller = new AbortController();
  _planAbortController = controller;
  const timeout = setTimeout(() => controller.abort(), 300_000);
  try {
    const body = JSON.stringify({ session_id: sessionId, ...routeRequest });
    const res = await fetch("/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: controller.signal,
    });
    if (!res.ok) {
      const data: ErrorBody | null = await res.json().catch(() => null);
      throw new Error(parseErrorDetail(data, `Planning failed: ${res.status}`));
    }
    const blob = await res.blob();
    const meta = await extractMetaFromZip(blob);
    return { blob, meta };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Request timed out — please try again.");
    }
    throw err;
  } finally {
    clearTimeout(timeout);
    if (_planAbortController === controller) _planAbortController = null;
  }
}

interface BuildRouteRequestOptions {
  start: LatLon;
  waypoints: LatLon[];
  pois: Poi[];
  config: FlightConfig;
  name?: string;
  notes?: string;
  takeoff_alt_m?: number;
}

/** Build a RouteRequest from app state. Landing is always start (return-to-home). */
export function buildRouteRequest({
  start, waypoints, pois, config,
  name = "", notes = "", takeoff_alt_m,
}: BuildRouteRequestOptions): Record<string, unknown> {
  const req: Record<string, unknown> = {
    name, notes, start, landing: start, waypoints,
    pois: pois.map((poi) => ({ point: poi.point, maneuver: poi.maneuver, name: poi.name || undefined })),
    config,
  };
  if (takeoff_alt_m !== undefined) req.takeoff_alt_m = takeoff_alt_m;
  return req;
}

/** Fetch the elevation heatmap PNG for a file in a session. */
export async function fetchElevationImage(
  sessionId: string,
  filename: string,
): Promise<{ url: string | null; error: string | null }> {
  try {
    const res = await fetch(`/elevation-image/${sessionId}/${encodeURIComponent(filename)}`);
    if (!res.ok) return { url: null, error: `HTTP ${res.status}` };
    return { url: URL.createObjectURL(await res.blob()), error: null };
  } catch (e) {
    return { url: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Request a PDF mission report from the backend for the given session. */
export async function downloadPdfReport(
  sessionId: string,
  operatorName: string,
  organization: string,
): Promise<Blob> {
  const res = await fetch(`/plan/${sessionId}/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ operator_name: operatorName, organization }),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `PDF generation failed: ${res.status}`));
  }
  return res.blob();
}

/** Fetch the data needed by the interactive altitude editor for a session. */
export async function fetchEditorData(sessionId: string): Promise<{
  waypoints: Array<{ lat: number; lon: number; alt_m: number; action: string }>;
  agl_profile: number[];
  poi_bands: Array<{ start_m: number; end_m: number; min_agl_m: number; max_agl_m: number }> | null;
  waypoint_indices: number[] | null;
}> {
  const res = await fetch(`/plan/${sessionId}/editor-data`);
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Editor data unavailable: ${res.status}`));
  }
  return res.json();
}

/** Apply manually-edited altitude overrides; returns updated ZIP blob + refreshed PlanMeta. */
export async function applyAltitudeEdit(
  sessionId: string,
  altOverrides: number[],
): Promise<{ blob: Blob; meta: PlanMeta | null }> {
  const res = await fetch(`/plan/${sessionId}/altitude-edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alt_overrides: altOverrides }),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Altitude edit failed: ${res.status}`));
  }
  const blob = await res.blob();
  const meta = await extractMetaFromZip(blob);
  return { blob, meta };
}

/** Tell the backend to save the full internal plan ZIP from an active session to the mission folder. */
export async function savePlanFromSession(folder: string, sessionId: string): Promise<void> {
  await fetch(`/missions/${encodeURIComponent(folder)}/plan-from-session`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId }),
  });
}

/** Fetch the saved plan ZIP for a mission and extract route data from it. */
export async function fetchMissionPlan(folder: string): Promise<{
  blob: Blob;
  meta: PlanMeta | null;
  routePoints: { lat: number; lon: number }[];
  aglProfile: number[] | null;
}> {
  const res = await fetch(`/missions/${encodeURIComponent(folder)}/plan`);
  if (!res.ok) throw new Error(`No saved plan: ${res.status}`);
  const blob = await res.blob();
  let meta: PlanMeta | null = null;
  let routePoints: { lat: number; lon: number }[] = [];
  let aglProfile: number[] | null = null;
  try {
    const zip = await JSZip.loadAsync(blob);
    const metaFile = zip.file("meta.json");
    if (metaFile) meta = JSON.parse(await metaFile.async("text")) as PlanMeta;
    const wpFile = zip.file("waypoints.json");
    if (wpFile) {
      const wps = JSON.parse(await wpFile.async("text")) as Array<{ lat: number; lon: number }>;
      routePoints = wps.map(({ lat, lon }) => ({ lat, lon }));
    }
    const aglFile = zip.file("agl_profile.json");
    if (aglFile) aglProfile = JSON.parse(await aglFile.async("text")) as number[];
  } catch { /* ignore parse errors */ }
  return { blob, meta, routePoints, aglProfile };
}

/** Fetch altitude editor data from the saved plan ZIP (no active session required). */
export async function fetchFolderEditorData(folder: string): Promise<{
  waypoints: Array<{ lat: number; lon: number; alt_m: number; action: string }>;
  agl_profile: number[];
  poi_bands: Array<{ start_m: number; end_m: number; min_agl_m: number; max_agl_m: number }> | null;
  waypoint_indices: number[] | null;
}> {
  const res = await fetch(`/missions/${encodeURIComponent(folder)}/editor-data`);
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Editor data unavailable: ${res.status}`));
  }
  return res.json();
}

/** Apply altitude overrides to a saved plan (no active session required). */
export async function applyFolderAltitudeEdit(
  folder: string,
  altOverrides: number[],
): Promise<{ blob: Blob; meta: PlanMeta | null }> {
  const res = await fetch(`/missions/${encodeURIComponent(folder)}/altitude-edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alt_overrides: altOverrides }),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Altitude edit failed: ${res.status}`));
  }
  const blob = await res.blob();
  const meta = await extractMetaFromZip(blob);
  return { blob, meta };
}

// ── Mission library ──────────────────────────────────────────────────────────

/** List all missions sorted by last-updated descending. */
export async function listMissions(): Promise<MissionSummary[]> {
  const res = await fetch("/missions");
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to load missions: ${res.status}`));
  }
  return res.json() as Promise<MissionSummary[]>;
}

/** Create a new empty mission. Returns the folder name. */
export async function createMission(name: string): Promise<{ folder: string }> {
  const res = await fetch("/missions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to create mission: ${res.status}`));
  }
  return res.json() as Promise<{ folder: string }>;
}

/** Load a mission's full state by folder name. */
export async function loadMission(folder: string): Promise<MissionState> {
  const res = await fetch(`/missions/${encodeURIComponent(folder)}`);
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to load mission: ${res.status}`));
  }
  return res.json() as Promise<MissionState>;
}

export interface MissionSavePayload {
  name: string;
  status: MissionStatus;
  notes: string;
  tiff_selections: TiffSelection[];
  route: Record<string, unknown>;
  preset_name?: string | null;
}

/** Save/overwrite a mission's state. */
export async function saveMission(folder: string, data: MissionSavePayload): Promise<void> {
  const res = await fetch(`/missions/${encodeURIComponent(folder)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(body, `Failed to save mission: ${res.status}`));
  }
}

/** Permanently delete a mission folder. */
export async function deleteMission(folder: string): Promise<void> {
  const res = await fetch(`/missions/${encodeURIComponent(folder)}`, { method: "DELETE" });
  if (!res.ok && res.status !== 204) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to delete mission: ${res.status}`));
  }
}

// ── Drone preset library ──────────────────────────────────────────────────────

/** Return the active preset list (from server disk or built-in defaults). */
export async function getPresets(): Promise<PresetItem[]> {
  const res = await fetch("/presets");
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to load presets: ${res.status}`));
  }
  return res.json() as Promise<PresetItem[]>;
}

/** Return whether the user has saved a custom presets.json on the server. */
export async function isPresetsCustomised(): Promise<boolean> {
  const res = await fetch("/presets/is-customised");
  if (!res.ok) return false;
  return res.json() as Promise<boolean>;
}

/** Persist the given preset list to the server. */
export async function savePresets(presets: PresetItem[]): Promise<void> {
  const res = await fetch("/presets", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(presets),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to save presets: ${res.status}`));
  }
}

// ── Application settings ─────────────────────────────────────────────────────

/** Return the active application settings (from server disk or built-in defaults). */
export async function getSettings(): Promise<AppSettings> {
  const res = await fetch("/settings");
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to load settings: ${res.status}`));
  }
  return res.json() as Promise<AppSettings>;
}

/** Persist the given settings to the server. */
export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const res = await fetch("/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to save settings: ${res.status}`));
  }
  return res.json() as Promise<AppSettings>;
}

// ── Dashboard analytics ───────────────────────────────────────────────────────

/** Return aggregated analytics across all saved missions. */
export async function getDashboardStats(): Promise<DashboardStats> {
  const res = await fetch("/dashboard/stats");
  if (!res.ok) {
    const data: ErrorBody | null = await res.json().catch(() => null);
    throw new Error(parseErrorDetail(data, `Failed to load dashboard stats: ${res.status}`));
  }
  return res.json() as Promise<DashboardStats>;
}

/** Trigger a browser download of a Blob with the given filename. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
