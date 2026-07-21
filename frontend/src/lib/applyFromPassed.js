import { isFinanceDemoEnabled } from "./demoSettings";
import { performFinanceDemoSwipe } from "./financeDemoApi";
import { notifyBillingPatch } from "./billingEvents";
/** Turn a passed job into a tailored application package (CV + cover letter). */
export async function applyFromPassedJob(apiClient, jobId) {
  if (isFinanceDemoEnabled()) {
    await apiClient.delete(`/swipes/${jobId}`).catch(() => {});
    const data = performFinanceDemoSwipe({ job_id: jobId, direction: "right" });
    if (!data?.ok) throw new Error("Finance demo apply failed");
    return data;
  }

  const { data } = await apiClient.post(`/swipes/${jobId}/apply-from-passed`, null, {
    timeout: 120000,
  });
  if (data?.billing) notifyBillingPatch(null, data.billing);
  return data;
}
