export interface TutorialStep {
  /** data-tutorial attribute value to spotlight; null = centered card, no spotlight */
  target: string | null;
  /** Sidebar tab to activate before showing this step (0=Mission, 1=Config, 2=Results) */
  tab: 0 | 1 | 2;
  title: string;
  body: string;
}

export const STEPS: TutorialStep[] = [
  {
    target: null,
    tab: 0,
    title: "Welcome to FlyHigh ✈",
    body: "This quick tour walks you through every key feature of the drone mission planner. You can stop at any time by pressing Esc or clicking ✕.",
  },
  {
    target: "upload",
    tab: 0,
    title: "1 · Upload Terrain",
    body: "Upload a GeoTIFF DSM (surface model) and/or DTM (bare-earth model). These give the planner elevation data to keep your drone safely above the ground and paint the map with a colour-coded terrain preview.",
  },
  {
    target: "home",
    tab: 0,
    title: "2 · Set Your Home Point",
    body: "Click this card, then click anywhere on the map to place the takeoff and landing point. Toggle between Auto (terrain-based altitude) and Fixed MSL to control exactly how high the drone lifts off.",
  },
  {
    target: "pois",
    tab: 0,
    title: "3 · Points of Interest",
    body: "POIs are the areas your drone will survey. Add one or more, place them on the map, then choose a coverage pattern — lawnmower sweeps or a custom polygon boundary. Drag the cards to reorder the visit sequence.",
  },
  {
    target: "flight-config",
    tab: 1,
    title: "4 · Flight Configuration",
    body: "Pick a drone preset or dial in your own values: min/max AGL altitude, cruise speed, climb rate, and battery capacity. The planner uses these to build a safe, efficient 3-D route with slope and clearance guarantees.",
  },
  {
    target: "plan-button",
    tab: 2,
    title: "5 · Plan Your Route",
    body: "Once terrain, a home point, and at least one POI are set, click Plan Route. The planner runs 21 steps — terrain loading, altitude profiling, slope propagation, safety checks — with live animated progress.",
  },
  {
    target: "results-panel",
    tab: 2,
    title: "6 · Review Results",
    body: "After planning you see total distance, estimated flight time, battery usage, and any safety violations. Click a violation to fly the map straight to that spot. Download a ZIP with the waypoint JSON and full mission log.",
  },
  {
    target: "flight-preview",
    tab: 2,
    title: "7 · Simulate the Flight",
    body: "Hit Simulate Flight to animate the drone along your planned route. Drag the progress bar to scrub to any moment, adjust playback speed (1×/5×/20×), and watch the AGL colour overlay shift as the terrain changes beneath the drone.",
  },
];
