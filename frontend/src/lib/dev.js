/** Skip auth gates during `npm start`. Set REACT_APP_DEV_BYPASS_AUTH=false to test real auth locally. */
export const devBypassAuth =
  process.env.NODE_ENV === "development" &&
  process.env.REACT_APP_DEV_BYPASS_AUTH !== "false";

/** Serve fake jobs/interviews/etc. for UI work. Set REACT_APP_DEMO_MODE=false to hit the real API. */
export const demoMode =
  devBypassAuth && process.env.REACT_APP_DEMO_MODE !== "false";
