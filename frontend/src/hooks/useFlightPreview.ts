import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import type { LatLon } from "../types/mission";
import { haversineM } from "../utils/math";

export type PreviewSpeed = 1 | 5 | 20;

export interface FlightPreviewState {
  isActive: boolean;
  isPlaying: boolean;
  /** 0–1 */
  progress: number;
  speedMultiplier: PreviewSpeed;
  dronePosition: LatLon | null;
  /** Degrees — bearing towards next waypoint, for icon rotation. */
  droneBearing: number;
  elapsedSec: number;
  totalDurationSec: number;
  activate: () => void;
  deactivate: () => void;
  play: () => void;
  pause: () => void;
  reset: () => void;
  setSpeed: (s: PreviewSpeed) => void;
  /** Seek to a 0–1 progress value. */
  seek: (p: number) => void;
}

export function useFlightPreview(routePoints: LatLon[], cruiseSpeedMs: number): FlightPreviewState {
  const [isActive, setIsActive] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [speedMultiplier, setSpeedMultiplier] = useState<PreviewSpeed>(1);

  const speedRef = useRef(speedMultiplier);
  speedRef.current = speedMultiplier;
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const elapsedRef = useRef(0);

  // Pre-compute cumulative distances along the route
  const cumDistances = useMemo(() => {
    if (routePoints.length < 2) return [0];
    const d = [0];
    for (let i = 1; i < routePoints.length; i++)
      d.push(d[i - 1] + haversineM(routePoints[i - 1], routePoints[i]));
    return d;
  }, [routePoints]);

  const totalDistM = cumDistances[cumDistances.length - 1] ?? 0;
  const totalDurationSec = cruiseSpeedMs > 0 && totalDistM > 0 ? totalDistM / cruiseSpeedMs : 0;
  const totalDurationRef = useRef(totalDurationSec);
  totalDurationRef.current = totalDurationSec;

  // Interpolate lat/lon and bearing at a given 0-1 progress value
  const positionAt = useCallback(
    (prog: number): { position: LatLon; bearing: number } | null => {
      if (routePoints.length < 2 || totalDistM === 0) return null;
      const targetDist = Math.min(Math.max(prog, 0), 1) * totalDistM;
      let lo = 1, hi = cumDistances.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumDistances[mid] < targetDist) lo = mid + 1; else hi = mid;
      }
      const i = lo;
      const prev = routePoints[i - 1];
      const curr = routePoints[i];
      const segDist = cumDistances[i] - cumDistances[i - 1];
      const t = segDist > 0 ? (targetDist - cumDistances[i - 1]) / segDist : 0;
      return {
        position: {
          lat: prev.lat + (curr.lat - prev.lat) * t,
          lon: prev.lon + (curr.lon - prev.lon) * t,
        },
        bearing:
          ((Math.atan2(curr.lon - prev.lon, curr.lat - prev.lat) * 180) / Math.PI + 360) % 360,
      };
    },
    [routePoints, cumDistances, totalDistM]
  );

  // RAF animation loop — starts when isPlaying, stops on cleanup or completion
  useEffect(() => {
    if (!isPlaying) return;

    const step = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;

      const dur = totalDurationRef.current;
      if (dur <= 0) {
        setIsPlaying(false);
        return;
      }

      elapsedRef.current = Math.min(elapsedRef.current + dt * speedRef.current, dur);
      const p = elapsedRef.current / dur;
      setProgress(p);

      if (p >= 1) {
        setIsPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      lastTsRef.current = null;
    };
  }, [isPlaying]);

  const pos = positionAt(progress);

  const activate = useCallback(() => setIsActive(true), []);
  const deactivate = useCallback(() => {
    setIsActive(false);
    setIsPlaying(false);
    setProgress(0);
    elapsedRef.current = 0;
  }, []);
  const play = useCallback(() => setIsPlaying(true), []);
  const pause = useCallback(() => setIsPlaying(false), []);
  const reset = useCallback(() => {
    setIsPlaying(false);
    setProgress(0);
    elapsedRef.current = 0;
    lastTsRef.current = null;
  }, []);
  const setSpeed = useCallback((s: PreviewSpeed) => setSpeedMultiplier(s), []);
  const seek = useCallback((p: number) => {
    const clamped = Math.min(Math.max(p, 0), 1);
    const dur = totalDurationRef.current;
    elapsedRef.current = clamped * dur;
    lastTsRef.current = null;
    setProgress(clamped);
  }, []);

  return {
    isActive,
    isPlaying,
    progress,
    speedMultiplier,
    dronePosition: pos?.position ?? null,
    droneBearing: pos?.bearing ?? 0,
    elapsedSec: elapsedRef.current,
    totalDurationSec,
    activate,
    deactivate,
    play,
    pause,
    reset,
    setSpeed,
    seek,
  };
}
