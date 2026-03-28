/** Centralised constants — all magic numbers live here. */

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
