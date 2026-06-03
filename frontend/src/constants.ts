/** Centralised constants — all magic numbers live here. */

/** Tile URL used when the backend is configured with OFFLINE_MAPS = True. */
const _apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
export const TILE_URL_OFFLINE = `${_apiUrl}/tiles/{z}/{x}/{y}.png`;

/** Tile URL used when the backend is configured with OFFLINE_MAPS = False. */
export const TILE_URL_ONLINE = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";

/** Shared attribution string for both tile sources. */
export const TILE_ATTRIBUTION =
  'Map data &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/** Canonical terrain raster types understood by the system. */
export const TERRAIN_TYPES = ["DSM", "DTM"] as const;
export type TerrainType = (typeof TERRAIN_TYPES)[number];

/** Debounce delay for elevation-point fetch while hovering over the map (ms). */
export const ELEVATION_FETCH_DEBOUNCE_MS = 120;

/** Maximum number of undo/redo history entries kept in memory. */
export const MAX_UNDO_HISTORY = 50;

/** localStorage key for auto-saved mission drafts. */
export const DRAFT_STORAGE_KEY = "flyhigh_draft_v1";

/** Debounce delay before auto-saving the current draft to localStorage (ms). */
export const DRAFT_SAVE_DEBOUNCE_MS = 500;

/** Debounce delay before recomputing live estimates after state changes (ms). */
export const LIVE_ESTIMATE_DEBOUNCE_MS = 150;
