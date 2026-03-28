import { createTheme } from "@mui/material";

export const appTheme = createTheme({
  palette: {
    mode: "dark",
    primary: { main: "#1E90FF" },
    secondary: { main: "#FF6347" },
    background: { default: "#0d1117", paper: "#161b22" },
  },
  typography: { fontFamily: "Inter, system-ui, sans-serif" },
  shape: { borderRadius: 8 },
});
