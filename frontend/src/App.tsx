import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Box, CssBaseline, GlobalStyles, Snackbar, ThemeProvider } from "@mui/material";

import { appTheme } from "./theme";
import { DRONE_PRESETS, DEFAULT_CONFIG } from "./dronePresets";
import type { DronePreset } from "./dronePresets";
import {
  activateTiffs,
  loadMission,
  saveMission,
  getPresets,
  savePlanFromSession,
  getSettings,
} from "./api";
import type { MissionSavePayload } from "./api";
import type {
  AppSettings,
  FlightConfig,
  LatLon,
  MissionStatus,
  UploadResult,
  Waypoint,
  Poi,
  PresetItem,
} from "./types/mission";
import { useMissionState } from "./hooks/useMissionState";
import { usePlanRoute } from "./hooks/usePlanRoute";
import { useRouteIO } from "./hooks/useRouteIO";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { useSnackbar } from "./hooks/useSnackbar";
import { useLiveEstimates } from "./hooks/useLiveEstimates";
import { useFlightPreview } from "./hooks/useFlightPreview";
import { useTerrainState } from "./hooks/useTerrainState";
import { usePlanResults } from "./hooks/usePlanResults";

import MapCanvas from "./components/map/MapCanvas";
import { TutorialOverlay } from "./components/tutorial/TutorialOverlay";
import { STEPS } from "./components/tutorial/tutorialSteps";
import { useTutorial } from "./hooks/useTutorial";
import { SidebarShell } from "./components/sidebar/SidebarShell";
import type { TabBadge } from "./components/sidebar/SidebarShell";
import { MissionTab } from "./components/sidebar/MissionTab";
import { ConfigTab } from "./components/sidebar/ConfigTab";
import { ResultsTab } from "./components/sidebar/ResultsTab";

const MIN_SIDEBAR_W = 260;
const MAX_SIDEBAR_FRACTION = 0.85;

export default function App() {
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState(0);
  const [sidebarWidth, setSidebarWidth] = useState(() => Math.round(window.innerWidth / 3));

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = sidebarWidth;
      const onMove = (ev: MouseEvent) => {
        setSidebarWidth(
          Math.min(
            Math.max(startW + ev.clientX - startX, MIN_SIDEBAR_W),
            Math.round(window.innerWidth * MAX_SIDEBAR_FRACTION)
          )
        );
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth]
  );
  const tutorial = useTutorial();

  // Terrain / session state (session ID, overlays, tiff selections)
  const terrain = useTerrainState();
  const { applyUploadResult, clearTerrain } = terrain;

  // Plan result state (meta, zip, route points, AGL profile)
  const planResults = usePlanResults();
  const { clearPlan, restorePlan, setPlanMeta, setZipBlob, setRoutePoints, setRouteAglProfile } =
    planResults;

  // Route / mission state (waypoints, POIs, undo history)
  const mission = useMissionState();
  const {
    start,
    waypoints,
    pois,
    missionName,
    missionNotes,
    interaction,
    canUndo,
    canRedo,
    setWaypoints,
    setMissionName,
    setMissionNotes,
    setInteraction,
    undo,
    redo,
    resetHistory,
  } = mission;

  // API-driven drone presets (falls back to hardcoded DRONE_PRESETS on error)
  const [apiPresets, setApiPresets] = useState<PresetItem[]>([]);
  useEffect(() => {
    getPresets()
      .then(setApiPresets)
      .catch(() => {
        /* fall back to DRONE_PRESETS */
      });
  }, []);

  // Global application settings
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    getSettings()
      .then(setAppSettings)
      .catch(() => {
        /* fall back to defaults in components */
      });
  }, []);

  // Config + takeoff — for new missions, defaults are overridden once settings load
  const [flightConfig, setFlightConfig] = useState<FlightConfig>(DEFAULT_CONFIG);
  const settingsAppliedRef = useRef(false);
  useEffect(() => {
    if (!appSettings || settingsAppliedRef.current || folder) return;
    settingsAppliedRef.current = true;
    setFlightConfig((prev) => ({
      ...prev,
      min_agl_m: appSettings.default_min_agl_m,
      max_agl_m: appSettings.default_max_agl_m,
      spacing_m: appSettings.default_spacing_m,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appSettings]);
  const [takeoffMode, setTakeoffMode] = useState<"auto" | "fixed">("auto");
  const [takeoffAltM, setTakeoffAltM] = useState(50);
  const [violationFilters, setViolationFilters] = useState({
    safety: true,
    product_poi: true,
    product_route: true,
  });
  const handleToggleViolationCategory = useCallback(
    (cat: "safety" | "product_poi" | "product_route") => {
      setViolationFilters((prev) => ({ ...prev, [cat]: !prev[cat] }));
    },
    []
  );

  // Mission metadata
  const [missionStatus, setMissionStatus] = useState<MissionStatus>("draft");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!!folder);
  const [mapFlyTarget, setMapFlyTarget] = useState<LatLon | null>(null);

  // Dirty tracking
  const [isDirty, setIsDirty] = useState(false);
  const isDirtyRef = useRef(false);
  const loadedRef = useRef(false);

  const { snack, showSnack, clearSnack } = useSnackbar();
  useKeyboardShortcuts({ interaction, setInteraction, setWaypoints });

  const liveEstimates = useLiveEstimates(start, waypoints, pois, flightConfig);
  const flightPreview = useFlightPreview(planResults.routePoints, flightConfig.cruise_speed_ms);

  // Dirty tracking — fires only after initial load completes
  useEffect(() => {
    if (!loadedRef.current) return;
    isDirtyRef.current = true;
    setIsDirty(true);
  }, [
    start,
    waypoints,
    pois,
    missionName,
    missionNotes,
    flightConfig,
    takeoffMode,
    takeoffAltM,
    missionStatus,
  ]);

  // Convert API presets to DronePreset shape; fall back to built-in if none loaded
  const dronePresets: DronePreset[] = useMemo(() => {
    if (apiPresets.length === 0) return DRONE_PRESETS;
    return apiPresets.map((p) => ({
      label: p.name,
      description: "",
      config: {
        cruise_speed_ms: p.cruise_speed_ms,
        climb_rate_ms: p.climb_rate_ms,
        battery_wh: p.battery_wh,
        drone_weight_kg: p.drone_weight_kg,
      },
    }));
  }, [apiPresets]);

  // Derive the active preset name for persisting with the mission
  const activePresetName = useMemo(() => {
    for (const p of apiPresets) {
      if (
        p.cruise_speed_ms === flightConfig.cruise_speed_ms &&
        p.climb_rate_ms === flightConfig.climb_rate_ms &&
        p.battery_wh === flightConfig.battery_wh &&
        p.drone_weight_kg === flightConfig.drone_weight_kg
      )
        return p.name;
    }
    return null;
  }, [apiPresets, flightConfig]);

  // Reset terrain selectors if the selected type is no longer loaded
  useEffect(() => {
    if (terrain.availableTerrainTypes.length === 0) return;
    setFlightConfig((prev) => ({
      ...prev,
      safety_radius_terrain: terrain.availableTerrainTypes.includes(prev.safety_radius_terrain)
        ? prev.safety_radius_terrain
        : terrain.availableTerrainTypes[0],
      camera_range_terrain: terrain.availableTerrainTypes.includes(prev.camera_range_terrain)
        ? prev.camera_range_terrain
        : terrain.availableTerrainTypes[0],
    }));
  }, [terrain.availableTerrainTypes]);

  // Warn before unload when dirty
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Load mission from backend on mount
  useEffect(() => {
    if (!folder) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);

    loadMission(folder)
      .then(async (state) => {
        resetHistory({
          start: state.route?.start ?? null,
          waypoints: (state.route?.waypoints as Waypoint[]) ?? [],
          pois: (state.route?.pois as Poi[]) ?? [],
        });
        if (state.name) setMissionName(state.name);
        if (state.route?.flightConfig) setFlightConfig(state.route.flightConfig as FlightConfig);
        if (state.route?.takeoffMode) setTakeoffMode(state.route.takeoffMode);
        if (state.route?.takeoffAltM != null) setTakeoffAltM(state.route.takeoffAltM);
        if (state.status) setMissionStatus(state.status);
        if (state.notes != null) setMissionNotes(state.notes);

        // Warn if the saved preset was deleted
        const savedPreset = state.preset_name ?? null;
        if (
          savedPreset &&
          apiPresets.length > 0 &&
          !apiPresets.some((p) => p.name === savedPreset)
        ) {
          showSnack(`'${savedPreset}' preset was removed — using saved values.`, "warning");
        }

        // Auto-activate saved terrain files
        if (state.tiff_selections?.length) {
          try {
            const result = await activateTiffs(state.tiff_selections);
            await applyUploadResult(result);
            // applyUploadResult does NOT clear plan — we restore it just below
          } catch {
            showSnack("Could not restore terrain — re-select files in the Mission tab.", "error");
          }
        }

        // Restore saved plan results (after terrain activation so they aren't cleared)
        if (state.plan_meta) {
          restorePlan(folder, state.plan_meta, () => {
            showSnack("Plan results unavailable — re-plan to restore.", "warning");
          });
        }
      })
      .catch(() => {
        showSnack("Failed to load mission — it may have been deleted.", "error");
        navigate("/missions");
      })
      .finally(() => {
        setIsLoading(false);
        loadedRef.current = true;
        isDirtyRef.current = false;
        setIsDirty(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folder]);

  // Upload handlers
  const handleUploadSuccess = useCallback(
    async (result: UploadResult) => {
      clearPlan(); // new terrain invalidates previous plan
      await applyUploadResult(result);
    },
    [clearPlan, applyUploadResult]
  );

  const handleUploadClear = useCallback(() => {
    clearTerrain();
  }, [clearTerrain]);

  // Save mission to backend
  const handleSaveMission = useCallback(async () => {
    if (!folder) return;
    setIsSaving(true);
    setSaveError(null);
    const payload: MissionSavePayload = {
      name: missionName || "Untitled Mission",
      status: missionStatus,
      notes: missionNotes,
      tiff_selections: terrain.tiffSelections,
      preset_name: activePresetName,
      route: {
        start,
        waypoints,
        pois: pois.map((p) => ({ ...p })),
        flightConfig,
        takeoffMode,
        takeoffAltM,
      } as Record<string, unknown>,
    };
    try {
      await saveMission(folder, payload);
      isDirtyRef.current = false;
      setIsDirty(false);
      showSnack("Mission saved.", "success");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save mission.";
      setSaveError(msg);
      showSnack(msg, "error");
    } finally {
      setIsSaving(false);
    }
  }, [
    folder,
    missionName,
    missionStatus,
    missionNotes,
    terrain.tiffSelections,
    start,
    waypoints,
    pois,
    flightConfig,
    takeoffMode,
    takeoffAltM,
    activePresetName,
    showSnack,
  ]);

  // Back to missions list
  const handleBack = useCallback(() => {
    if (isDirtyRef.current && !window.confirm("You have unsaved changes. Leave anyway?")) return;
    isDirtyRef.current = false;
    navigate("/missions");
  }, [navigate]);

  // Route IO (JSON export/import)
  const {
    loadRouteError,
    loadRouteSnack,
    clearLoadRouteError,
    clearLoadRouteSnack,
    handleSaveRoute: handleExportRoute,
    handleLoadRoute,
  } = useRouteIO(
    { start, waypoints, pois, flightConfig, missionName, tiffSelections: terrain.tiffSelections },
    async ({ start: s, waypoints: wps, pois: ps, flightConfig: fc, name, tiff_selections }) => {
      resetHistory({
        start: s ?? null,
        waypoints: (wps as Waypoint[]) ?? [],
        pois: ps ?? [],
      });
      if (fc) setFlightConfig(fc as FlightConfig);
      if (name) setMissionName(name);
      if (tiff_selections?.length) {
        try {
          const result = await activateTiffs(tiff_selections);
          clearPlan();
          await applyUploadResult(result);
        } catch {
          showSnack("Could not restore terrain — re-select files in the Mission tab.", "error");
        }
      }
    }
  );

  useEffect(() => {
    if (loadRouteSnack) {
      showSnack(loadRouteSnack, "success");
      clearLoadRouteSnack();
    }
  }, [loadRouteSnack, showSnack, clearLoadRouteSnack]);

  // Waypoint editing
  const handleWaypointNameChange = useCallback(
    (i: number, name: string) => {
      setWaypoints((prev) => prev.map((wp, j) => (j === i ? { ...wp, name } : wp)));
    },
    [setWaypoints]
  );

  const handleRemoveWaypoint = useCallback(
    (i: number) => {
      setWaypoints((prev) => prev.filter((_, j) => j !== i));
    },
    [setWaypoints]
  );

  // Planning
  const canPlan = !!terrain.sessionId && !!start && pois.length > 0;
  const isConfigValid = flightConfig.min_agl_m < flightConfig.max_agl_m;

  const { isPlanning, planningStep, planError, clearPlanError, handlePlan } = usePlanRoute(
    {
      sessionId: terrain.sessionId,
      start,
      waypoints,
      pois,
      flightConfig,
      missionName,
      missionNotes,
      takeoffMode,
      takeoffAltM,
    },
    (meta, blob, routePts, aglProfile) => {
      setPlanMeta(meta);
      setZipBlob(blob);
      setRoutePoints(routePts);
      setRouteAglProfile(aglProfile);
      setMapFlyTarget(null);
      if (meta?.smart_route_summary) showSnack(meta.smart_route_summary, "info");
      setActiveTab(2);
      if (folder && terrain.sessionId) {
        savePlanFromSession(folder, terrain.sessionId).catch(() => {
          /* fire-and-forget */
        });
      }
    }
  );

  useEffect(() => {
    if (isPlanning) setActiveTab(2);
  }, [isPlanning]);

  const tabs = [
    {
      label: "Mission",
      badge: (terrain.uploadResult && start && pois.length > 0 ? "ready" : "none") as TabBadge,
      content: (
        <MissionTab
          missionName={missionName}
          missionNotes={missionNotes}
          onNameChange={setMissionName}
          onNotesChange={setMissionNotes}
          onSave={handleSaveMission}
          isSaving={isSaving}
          saveError={saveError}
          isDirty={isDirty}
          onExport={handleExportRoute}
          onLoad={handleLoadRoute}
          loadRouteError={loadRouteError}
          onClearLoadRouteError={clearLoadRouteError}
          canUndo={canUndo}
          canRedo={canRedo}
          onUndo={undo}
          onRedo={redo}
          status={missionStatus}
          onStatusChange={setMissionStatus}
          onBack={handleBack}
          uploadResult={terrain.uploadResult}
          elevationErrors={terrain.elevationErrors}
          onUploadSuccess={handleUploadSuccess}
          onUploadClear={handleUploadClear}
          takeoffMode={takeoffMode}
          takeoffAltM={takeoffAltM}
          onTakeoffModeChange={setTakeoffMode}
          onTakeoffAltChange={setTakeoffAltM}
          start={start}
          waypoints={waypoints}
          pois={pois}
          interaction={interaction}
          onSetPlaceMode={mission.handleSetPlaceMode}
          onRemoveWaypoint={handleRemoveWaypoint}
          onWaypointNameChange={handleWaypointNameChange}
          onPoiChange={mission.handlePoiChange}
          onPoiRemove={mission.handlePoiRemove}
          onPoiActivatePlace={mission.handlePoiActivatePlace}
          onActivatePolygonDraw={mission.handleActivatePolygonDraw}
          onPoiDragStart={mission.handlePoiDragStart}
          onPoiDrop={mission.handlePoiDrop}
          onAddPoi={mission.handleAddPoi}
          liveEstimates={liveEstimates}
        />
      ),
    },
    {
      label: "Config",
      badge: (!isConfigValid ? "warning" : "none") as TabBadge,
      content: (
        <ConfigTab
          config={flightConfig}
          onChange={setFlightConfig}
          isValid={isConfigValid}
          presets={dronePresets}
          availableTerrainTypes={terrain.availableTerrainTypes}
        />
      ),
    },
    {
      label: "Results",
      badge: (isPlanning ? "loading" : planResults.planMeta ? "done" : "none") as TabBadge,
      content: (
        <ResultsTab
          meta={planResults.planMeta}
          zipBlob={planResults.zipBlob}
          flightPreview={flightPreview}
          canPlan={canPlan}
          isConfigValid={isConfigValid}
          isPlanning={isPlanning}
          planningStep={planningStep}
          planError={planError}
          sessionId={terrain.sessionId}
          folder={folder ?? null}
          missionName={missionName}
          hasStart={!!start}
          hasPois={pois.length > 0}
          onPlan={handlePlan}
          onClearPlanError={clearPlanError}
          onViolationClick={(lat, lon) => setMapFlyTarget({ lat, lon })}
          onAltitudesApplied={(blob, meta) => {
            setZipBlob(blob);
            setPlanMeta(meta);
            showSnack("Altitude edits applied — results updated.", "success");
          }}
          batteryWarningPct={appSettings?.battery_warning_pct}
          batteryErrorPct={appSettings?.battery_error_pct}
          violationFilters={violationFilters}
          onToggleViolationCategory={handleToggleViolationCategory}
        />
      ),
    },
  ];

  if (isLoading) {
    return (
      <ThemeProvider theme={appTheme}>
        <CssBaseline />
        <Box
          sx={{
            height: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "background.default",
          }}
        >
          <Box sx={{ color: "text.secondary" }}>Loading mission…</Box>
        </Box>
      </ThemeProvider>
    );
  }

  return (
    <ThemeProvider theme={appTheme}>
      <CssBaseline />
      <GlobalStyles
        styles={{
          "@keyframes tutGlow": { from: { opacity: 0.7 }, to: { opacity: 1 } },
          "@keyframes tutPulse": {
            "0%, 100%": { boxShadow: "0 0 0 0 rgba(30,144,255,0.5)" },
            "50%": { boxShadow: "0 0 0 8px rgba(30,144,255,0)" },
          },
        }}
      />
      <Box
        sx={{ height: "100vh", display: "flex", overflow: "hidden", bgcolor: "background.default" }}
      >
        <SidebarShell
          tabs={tabs}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onTourStart={tutorial.start}
          tourActive={tutorial.active}
          width={sidebarWidth}
        />

        {/* Drag handle */}
        <Box
          onMouseDown={handleDragStart}
          sx={{
            width: 4,
            flexShrink: 0,
            cursor: "col-resize",
            bgcolor: "#21262d",
            transition: "background-color 0.15s",
            "&:hover": { bgcolor: "#388bfd" },
            zIndex: 10,
          }}
        />

        <Box sx={{ flex: 1, position: "relative", overflow: "hidden" }}>
          <MapCanvas
            start={start}
            waypoints={waypoints}
            pois={pois}
            uploadResult={terrain.uploadResult}
            routePoints={planResults.routePoints}
            routeAglProfile={planResults.routeAglProfile ?? undefined}
            minAglM={flightConfig.min_agl_m}
            mapFlyTarget={mapFlyTarget}
            interaction={interaction}
            onPlacePoint={mission.handlePlacePoint}
            onSetPlaceMode={mission.handleSetPlaceMode}
            onPolygonVertex={mission.handlePolygonVertex}
            onPolygonClose={mission.handlePolygonClose}
            onPolygonVertexDrag={mission.handlePolygonVertexDrag}
            onPolygonVertexDragInProgress={mission.handlePolygonVertexDragInProgress}
            onPoiDrag={mission.handlePoiDrag}
            elevationOverlays={terrain.elevationOverlays}
            sessionId={terrain.sessionId}
            mapBottomPad="8px"
            flightPreview={flightPreview.isActive ? flightPreview : undefined}
            violations={(planResults.planMeta?.violations ?? []).filter(
              (v) => violationFilters[v.category as keyof typeof violationFilters] ?? false
            )}
          />
        </Box>
      </Box>

      {tutorial.active && (
        <TutorialOverlay
          step={STEPS[tutorial.stepIndex]}
          stepIndex={tutorial.stepIndex}
          total={tutorial.total}
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          onNext={tutorial.next}
          onBack={tutorial.back}
          onStop={tutorial.stop}
        />
      )}

      <Snackbar
        open={!!snack}
        autoHideDuration={snack?.severity === "success" ? 4000 : 8000}
        onClose={clearSnack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
        message={snack?.message}
      />
    </ThemeProvider>
  );
}
