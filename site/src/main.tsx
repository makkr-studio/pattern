import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./lib/theme"; // apply the resolved theme at boot
import "./index.css";
import { App } from "./App";

// Always open at the top; we drive our own in-view animations.
if (typeof history !== "undefined" && "scrollRestoration" in history) {
  history.scrollRestoration = "manual";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
