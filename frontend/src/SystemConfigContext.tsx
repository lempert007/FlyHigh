import { createContext, useContext, useEffect, useState } from "react";
import { TILE_ATTRIBUTION, TILE_URL_OFFLINE, TILE_URL_ONLINE } from "./constants";

interface SystemConfig {
  tileUrl: string;
  tileAttribution: string;
}

// Default to offline — safe fallback if the backend hasn't responded yet
const defaults: SystemConfig = {
  tileUrl: TILE_URL_OFFLINE,
  tileAttribution: TILE_ATTRIBUTION,
};

const SystemConfigContext = createContext<SystemConfig>(defaults);

export function SystemConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<SystemConfig>(defaults);

  useEffect(() => {
    fetch("/system-config")
      .then((r) => r.json())
      .then((data: { offline_maps: boolean }) => {
        setConfig({
          tileUrl: data.offline_maps ? TILE_URL_OFFLINE : TILE_URL_ONLINE,
          tileAttribution: TILE_ATTRIBUTION,
        });
      })
      .catch(() => {
        // Backend unreachable — keep offline default
      });
  }, []);

  return <SystemConfigContext.Provider value={config}>{children}</SystemConfigContext.Provider>;
}

export function useSystemConfig(): SystemConfig {
  return useContext(SystemConfigContext);
}
