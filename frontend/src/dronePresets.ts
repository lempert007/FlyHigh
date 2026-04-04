import type { FlightConfig } from "./types/mission";

export interface DronePreset {
  label: string;
  description: string;
  config: Pick<
    FlightConfig,
    "cruise_speed_ms" | "climb_rate_ms" | "battery_wh" | "drone_weight_kg"
  > &
    Partial<
      Pick<
        FlightConfig,
        | "min_agl_m"
        | "max_agl_m"
        | "point_radius_m"
        | "max_surface_radius_m"
        | "spacing_m"
        | "min_altitude_step_m"
      >
    >;
}

export const DRONE_PRESETS: DronePreset[] = [
  {
    label: "Drone 1",
    description: "Sub-250g mini drone — light survey, short range",
    config: {
      cruise_speed_ms: 10,
      climb_rate_ms: 3,
      battery_wh: 600,
      drone_weight_kg: 6,
    },
  },
  {
    label: "Drone 2",
    description: "Mid-size quadcopter — general mapping",
    config: {
      cruise_speed_ms: 15,
      climb_rate_ms: 6,
      battery_wh: 1550,
      drone_weight_kg: 2.5,
    },
  },
  {
    label: "Fixed Wing 1",
    description: "Fixed-wing UAV — long range, fast cruise",
    config: {
      cruise_speed_ms: 25,
      climb_rate_ms: 4,
      battery_wh: 300,
      drone_weight_kg: 1.5,
    },
  },
];

export const DEFAULT_CONFIG: FlightConfig = {
  min_agl_m: 80,
  max_agl_m: 400,
  point_radius_m: 100,
  max_surface_radius_m: 100,
  cruise_speed_ms: 10,
  climb_rate_ms: 2,
  spacing_m: 10,
  battery_wh: 600,
  drone_weight_kg: 7,
  smart_route: false,
  smart_route_corridor_m: 50,
  optimize_poi_order: false,
  min_altitude_step_m: 10,
  max_slope_ratio: null,
  safety_radius_terrain: "DSM",
  camera_range_terrain: "DTM",
};
