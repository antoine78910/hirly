import { isFinanceDemoEnabled } from "./demoSettings";
import { isDemoAccountEnabled, seedDemoShowcaseIfEmpty } from "./demoAccount";
import { seedFinanceDemoShowcaseIfEmpty } from "./financeDemoApi";

/** Seed tracker + inbox showcase rows when demo modes have no applications yet. */
export function ensureDemoScreenshotData() {
  if (isFinanceDemoEnabled()) {
    seedFinanceDemoShowcaseIfEmpty();
    return;
  }
  if (isDemoAccountEnabled()) {
    seedDemoShowcaseIfEmpty();
  }
}
