import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Login from "./Login";
import "./styles.css";
import "./modern.css";
import "./premium.css";
document.documentElement.dataset.theme =
  localStorage.getItem("qa-atlas-theme") === "light" ? "light" : "dark";
const signInUrl =
  "/login?return_to=" + encodeURIComponent("/" + location.search);
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {location.pathname === "/login" ? (
      <Login />
    ) : (
      <App hostedRuntime signInUrl={signInUrl} />
    )}
  </React.StrictMode>,
);

import "./refined.css";
