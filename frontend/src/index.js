import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { installDevEmbedErrorFilter } from "@/lib/devEmbedErrorFilter";
import { applyMobileTheme, readMobileTheme } from "@/lib/mobileTheme";

installDevEmbedErrorFilter();
applyMobileTheme(readMobileTheme());

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
