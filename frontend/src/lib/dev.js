/** TEMP: tutorial filming — set to false and redeploy when done. */
export const TUTORIAL_BYPASS_AUTH = true;

/** Skip auth gates during `npm start`, or while TUTORIAL_BYPASS_AUTH is enabled. */
export const devBypassAuth =
  TUTORIAL_BYPASS_AUTH ||
  (process.env.NODE_ENV === "development" &&
  process.env.REACT_APP_DEV_BYPASS_AUTH !== "false");

/** Serve fake jobs/interviews/etc. for UI work. Set REACT_APP_DEMO_MODE=false to hit the real API. */
export const demoMode =
  devBypassAuth && process.env.REACT_APP_DEMO_MODE !== "false";
