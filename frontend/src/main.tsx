import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles.css";
import { applyCursorPreference, getCursorPreference } from "./lib/cursorPreference";

// Before the first render, so the page never flashes the wrong cursor.
applyCursorPreference(getCursorPreference());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
