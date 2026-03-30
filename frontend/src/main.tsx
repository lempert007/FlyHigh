import "leaflet/dist/leaflet.css";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import LandingPage from "./LandingPage";
import MissionsPage from "./pages/MissionsPage";
import DashboardPage from "./pages/DashboardPage";
import { SystemConfigProvider } from "./SystemConfigContext";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SystemConfigProvider>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/missions" element={<MissionsPage />} />
        <Route path="/missions/:folder" element={<App />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
    </SystemConfigProvider>
  </React.StrictMode>
);
