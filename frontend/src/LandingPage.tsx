import React, { useEffect, useState } from "react";
import { Box, Button, Typography, ThemeProvider, CssBaseline, createTheme } from "@mui/material";
import DroneIcon from "./components/DroneIcon";
import { useNavigate } from "react-router-dom";

const landingTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#1E90FF" },
    background: { default: "#0d1117" },
  },
  typography: { fontFamily: "Inter, system-ui, sans-serif" },
});

function MapBackground() {
  return (
    <Box
      component="svg"
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none" }}
    >
      <path stroke="#1E90FF" strokeWidth={1.5} fill="none" strokeDasharray="8 6" opacity={0.15}
        d="M-60,600 Q200,500 400,520 T700,400 T1000,300 T1300,200 T1500,100" />
      <path stroke="#1E90FF" strokeWidth={1.5} fill="none" strokeDasharray="8 6" opacity={0.09}
        d="M-60,200 Q150,280 350,260 T650,340 T950,450 T1200,520 T1500,600" />
      {[[400, 520], [700, 400], [1000, 300], [1300, 200]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r={4} fill="#1E90FF" opacity={0.18} />
      ))}
      {[[350, 260], [650, 340], [950, 450]].map(([cx, cy], i) => (
        <circle key={`b${i}`} cx={cx} cy={cy} r={3} fill="#1E90FF" opacity={0.1} />
      ))}
    </Box>
  );
}

export default function LandingPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <ThemeProvider theme={landingTheme}>
      <CssBaseline />
      <Box sx={{
        height: "100vh", width: "100vw",
        bgcolor: "background.default",
        display: "flex", alignItems: "center", justifyContent: "center",
        overflow: "hidden", position: "relative",
      }}>
        <MapBackground />
        <Box sx={{
          position: "relative", zIndex: 1,
          display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center",
          opacity: ready ? 1 : 0,
          transform: ready ? "translateY(0)" : "translateY(24px)",
          transition: "opacity 0.7s ease, transform 0.7s ease",
        }}>
          <Box sx={{
            mb: 2.5, display: "flex", alignItems: "center", justifyContent: "center",
            "@keyframes pulseGlow": {
              "0%, 100%": { filter: "drop-shadow(0 0 8px #1E90FF88)", transform: "scale(1)" },
              "50%":       { filter: "drop-shadow(0 0 20px #1E90FFcc)", transform: "scale(1.06)" },
            },
            animation: "pulseGlow 3s ease-in-out infinite",
          }}>
            <DroneIcon sx={{ fontSize: 56, color: "primary.main" }} />
          </Box>

          <Typography sx={{ fontSize: "3.2rem", fontWeight: 900, letterSpacing: "6px", lineHeight: 1, color: "#fff", m: 0 }}>
            FLY<Box component="span" sx={{ color: "primary.main" }}>HIGH</Box>
          </Typography>

          <Typography sx={{ fontSize: "0.7rem", fontWeight: 700, letterSpacing: "5px", textTransform: "uppercase", color: "primary.main", opacity: 0.8, mt: 1, mb: 3.5 }}>
            Stay Low
          </Typography>

          <Typography sx={{ fontSize: "1rem", color: "#8b949e", maxWidth: 380, lineHeight: 1.6, mb: 5, fontWeight: 400 }}>
            Precision mission planning for survey, inspection&nbsp;&amp;&nbsp;research drones.
          </Typography>

          <Button
            variant="contained"
            onClick={() => navigate("/missions")}
            sx={{
              borderRadius: "999px", px: 5.5, py: 1.75,
              fontSize: "1rem", fontWeight: 700, letterSpacing: "0.5px", textTransform: "none",
              boxShadow: "0 0 32px #1E90FF55, 0 4px 16px rgba(0,0,0,0.4)",
              transition: "transform 0.18s ease, box-shadow 0.18s ease",
              "&:hover": { transform: "translateY(-3px)", boxShadow: "0 0 44px #1E90FF88, 0 8px 24px rgba(0,0,0,0.5)" },
              "&:active": { transform: "translateY(0)" },
            }}
          >
            Open Mission Planner
          </Button>

          <Box sx={{ mt: 2.5, display: "flex", alignItems: "center", gap: 1.5 }}>
            {["Safety insurance", "Route planning"].map((label, i) => (
              <React.Fragment key={label}>
                {i > 0 && <Box sx={{ width: 5, height: 5, borderRadius: "50%", bgcolor: "primary.main", opacity: 0.35 }} />}
                <Typography sx={{ fontSize: "0.68rem", color: "#30363d", letterSpacing: "1px", textTransform: "uppercase" }}>
                  {label}
                </Typography>
              </React.Fragment>
            ))}
          </Box>
        </Box>
      </Box>
    </ThemeProvider>
  );
}
