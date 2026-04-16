import "./index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { CockpitStandaloneApp } from "./CockpitStandaloneApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CockpitStandaloneApp />
  </StrictMode>,
);
