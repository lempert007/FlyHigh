import { useState, useCallback } from "react";
import type { LatLon, Waypoint, Poi, FlightConfig, RouteFileEnvelope, TiffSelection } from "../types/mission";

interface MissionData {
  start: LatLon | null;
  waypoints: Waypoint[];
  pois: Poi[];
  flightConfig: FlightConfig;
  missionName: string;
  tiffSelections?: TiffSelection[];
}

interface LoadedRoute {
  start?: LatLon;
  waypoints?: Waypoint[];
  pois?: Poi[];
  flightConfig?: FlightConfig;
  name?: string;
  tiff_selections?: TiffSelection[];
}

interface UseRouteIOReturn {
  loadRouteError: string | null;
  loadRouteSnack: string | null;
  clearLoadRouteError: () => void;
  clearLoadRouteSnack: () => void;
  handleSaveRoute: () => Promise<void>;
  handleLoadRoute: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export function useRouteIO(data: MissionData, onLoad: (route: LoadedRoute) => void | Promise<void>): UseRouteIOReturn {
  const [loadRouteError, setLoadRouteError] = useState<string | null>(null);
  const [loadRouteSnack, setLoadRouteSnack] = useState<string | null>(null);

  const clearLoadRouteError = useCallback(() => setLoadRouteError(null), []);
  const clearLoadRouteSnack = useCallback(() => setLoadRouteSnack(null), []);

  const handleSaveRoute = useCallback(async () => {
    const { start, waypoints, pois, flightConfig, missionName, tiffSelections } = data;
    const payload = { start, waypoints, pois, flightConfig };
    const canonical = JSON.stringify(payload);
    const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
    const hash = Array.from(new Uint8Array(hashBuf))
      .map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);

    const envelope: RouteFileEnvelope = {
      version: 1,
      name: missionName || undefined,
      saved_at: new Date().toISOString(),
      hash,
      tiff_selections: tiffSelections?.length ? tiffSelections : undefined,
      route: payload,
    };

    const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(missionName || "flyhigh_route").replace(/[^\w-]/g, "_")}_${hash.slice(0, 8)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [data]);

  const handleLoadRoute = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLoadRouteError(null);

    const reader = new FileReader();
    reader.onerror = () => setLoadRouteError("Failed to read file.");
    reader.onload = (ev) => {
      try {
        const raw: unknown = JSON.parse(ev.target?.result as string);
        const isEnvelope = (raw as RouteFileEnvelope).version === 1 && "route" in (raw as object);
        const envelope = isEnvelope ? (raw as RouteFileEnvelope) : null;
        const routeData = envelope ? envelope.route : raw as LoadedRoute;
        const name = envelope?.name ?? "";
        const tiff_selections = envelope?.tiff_selections;

        // Assign stable IDs to pois loaded from file (may predate the id field)
        const poisWithIds = routeData.pois?.map((p) => ({
          ...p,
          id: (p as { id?: string }).id ?? crypto.randomUUID(),
        })) as typeof routeData.pois;
        onLoad({ ...routeData, pois: poisWithIds, start: routeData.start ?? undefined, name, tiff_selections });

        const wpCount = routeData.waypoints?.length ?? 0;
        const poiCount = (routeData as LoadedRoute).pois?.length ?? 0;
        setLoadRouteSnack(
          `Route loaded${name ? `: "${name}"` : ""} — ${wpCount} waypoint${wpCount !== 1 ? "s" : ""}, ${poiCount} POI${poiCount !== 1 ? "s" : ""}`
        );
      } catch {
        setLoadRouteError("Could not load route file — invalid or unsupported format.");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  }, [onLoad]);

  return { loadRouteError, loadRouteSnack, clearLoadRouteError, clearLoadRouteSnack, handleSaveRoute, handleLoadRoute };
}
