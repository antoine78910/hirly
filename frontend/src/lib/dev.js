/** TEMP: tutorial filming — set to false and redeploy when done. */
export const TUTORIAL_BYPASS_AUTH = true;

/** Skip auth gates during `npm start`, or while TUTORIAL_BYPASS_AUTH is enabled. */
export const devBypassAuth =
  TUTORIAL_BYPASS_AUTH ||
  (process.env.NODE_ENV === "development" &&
  process.env.REACT_APP_DEV_BYPASS_AUTH !== "false");

/** Full local API mock (fake jobs). Off during tutorial filming — real feed, simulated applies. */
export const demoMode =
  devBypassAuth &&
  !TUTORIAL_BYPASS_AUTH &&
  process.env.REACT_APP_DEMO_MODE !== "false";
