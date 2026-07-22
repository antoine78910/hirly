import React from "react";
import ReactDOM from "react-dom/client";
import "@/index.css";
import App from "@/App";
import { installDevEmbedErrorFilter } from "@/lib/devEmbedErrorFilter";
import { applyMobileTheme, readMobileTheme } from "@/lib/mobileTheme";
import { PostHogProvider } from "@posthog/react";
import { initializePostHog } from "@/lib/posthogClient";

installDevEmbedErrorFilter();
applyMobileTheme(readMobileTheme());
const posthogClient = initializePostHog();

const root = ReactDOM.createRoot(document.getElementById("root"));
const app = posthogClient ? (
  <PostHogProvider client={posthogClient}>
    <App />
  </PostHogProvider>
) : (
  <App />
);
root.render(<React.StrictMode>{app}</React.StrictMode>);
