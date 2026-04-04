import type { TerrainType } from "../constants";

export interface LatLon {
  lat: number;
  lon: number;
}

export interface Waypoint extends LatLon {
  name?: string;
}

export type PlaceMode = "none" | "start" | "waypoint" | "poi";
export type InteractionMode = PlaceMode | "polygon";

export interface InteractionState {
  mode: InteractionMode;
  poiIndex: number | null;
  polygonVertices: LatLon[];
}

export const INTERACTION_RESET: InteractionState = {
  mode: "none",
  poiIndex: null,
  polygonVertices: [],
};

export type ManeuverType = "lawnmower" | "warp_weft" | "smart_lawnmower";

export interface Maneuver {
  type: ManeuverType;
  width_m: number;
  height_m: number;
  sweep_spacing_m: number;
  smart_fov_deg: number;
  smart_overlap: number;
  poi_min_agl_m: number | null;
  poi_max_agl_m: number | null;
  polygon?: LatLon[];
}

export interface SmartLawnmowerPreview {
  precise_spacing_m: number;
  overlap_spacing_m: number;
  estimated_strips: number | null;
  warning: string | null;
}

export interface Poi {
  id: string; // stable client-side identity for React keys; never sent to the backend
  name: string;
  point: LatLon;
  maneuver: Maneuver;
}

export interface FlightConfig {
  min_agl_m: number;
  max_agl_m: number;
  point_radius_m: number;
  max_surface_radius_m: number;
  cruise_speed_ms: number;
  climb_rate_ms: number;
  spacing_m: number;
  battery_wh: number;
  drone_weight_kg: number;
  smart_route: boolean;
  smart_route_corridor_m: number;
  optimize_poi_order: boolean;
  min_altitude_step_m: number;
  /** Max altitude change per metre horizontal (m/m). null = auto from climb_rate/speed. */
  max_slope_ratio: number | null;
  safety_radius_terrain: TerrainType;
  camera_range_terrain: TerrainType;
}

export interface AvailableTiff {
  name: string;
  inferred_type: TerrainType | "unknown";
}

export interface TiffSelection {
  name: string;
  type: TerrainType;
}

export interface TerrainFile {
  name: string;
  bbox: [number, number, number, number]; // [west, south, east, north]
  inferred_type: TerrainType;
  resolution_m: number;
  crs: string;
}

export interface UploadResult {
  session_id: string;
  files: TerrainFile[];
}

export interface ElevationOverlay {
  url: string;
  bbox: [number, number, number, number];
  filename: string;
  type: TerrainType;
}

export interface Violation {
  point_index: number;
  kind: string;
  category: "safety" | "product_route" | "product_poi";
  description: string;
  lat: number;
  lon: number;
}

export interface PlanMeta {
  total_distance_m: number;
  flight_time_s: number;
  budget_pct: number;
  violations: Violation[];
  energy_wh?: number;
  covered_area_m2?: number;
  terrain_resolution_m?: number;
  smart_route_summary?: string;
  error?: string;
  warning?: string;
  min_clearance_m?: number;
  mean_clearance_m?: number;
  tight_segment_count?: number;
  min_agl_m?: number;
  max_agl_m?: number;
  poi_scan_good_pct?: number;
  rth_reserve_pct?: number;
}

export interface ProfilePoint {
  dist_m: number;
  segment_type: "transit" | "poi_scan" | "waypoint";
  poi_id: number | null;
  waypoint_id: number | null;
}

export type MissionStatus = "draft" | "ready" | "flown";

export interface RoutePreview {
  start: { lat: number; lon: number } | null;
  waypoints: { lat: number; lon: number }[];
  pois: { lat: number; lon: number }[];
}

export interface MissionSummary {
  folder: string;
  name: string;
  status: MissionStatus;
  created_at: string;
  updated_at: string;
  has_thumbnail: boolean;
  route_preview?: RoutePreview | null;
}

export interface MissionState {
  schema_version: number;
  name: string;
  status: MissionStatus;
  created_at: string;
  updated_at: string;
  notes: string;
  /** Name of the drone preset active when the mission was last saved. */
  preset_name?: string | null;
  tiff_selections: TiffSelection[];
  route: {
    start: LatLon | null;
    waypoints: Waypoint[];
    pois: Poi[];
    flightConfig: FlightConfig;
    takeoffMode: "auto" | "fixed";
    takeoffAltM: number;
  };
  plan_meta?: PlanMeta | null;
}

// ── Drone preset (from API) ───────────────────────────────────────────────────

export interface PresetItem {
  name: string;
  cruise_speed_ms: number;
  climb_rate_ms: number;
  battery_wh: number;
  drone_weight_kg: number;
  // Optional flight config overrides
  min_agl_m?: number | null;
  max_agl_m?: number | null;
  point_radius_m?: number | null;
  max_surface_radius_m?: number | null;
  spacing_m?: number | null;
  min_altitude_step_m?: number | null;
}

// ── Dashboard analytics ───────────────────────────────────────────────────────

export interface MissionPin {
  folder: string;
  name: string;
  status: MissionStatus;
  created_at: string;
  lat: number | null;
  lon: number | null;
}

export interface RecentMission {
  folder: string;
  name: string;
  status: MissionStatus;
  updated_at: string;
}

export interface DashboardStats {
  missions_by_status: Record<string, number>;
  total_area_m2: number;
  missions_with_area: number;
  estimated_flight_hours: number;
  most_used_preset: string | null;
  recent_activity: RecentMission[];
  mission_pins: MissionPin[];
}

// ── Application settings ──────────────────────────────────────────────────────

export interface AppSettings {
  default_min_agl_m: number;
  default_max_agl_m: number;
  default_spacing_m: number;
  battery_warning_pct: number;
  battery_error_pct: number;
}

export interface RouteFileEnvelope {
  version: 1;
  name?: string;
  saved_at: string;
  hash: string;
  tiff_selections?: TiffSelection[];
  route: {
    start: LatLon | null;
    waypoints: Waypoint[];
    pois: Poi[];
    flightConfig: FlightConfig;
  };
}
