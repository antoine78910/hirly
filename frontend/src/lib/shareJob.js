import { BRAND } from "./brand";

export function jobSharePayload(job) {
  const title = `${job.title} at ${job.company}`;
  const text = `Check out this role on ${BRAND.NAME}: ${job.title} at ${job.company}`;
  const url = `${window.location.origin}/swipe?job=${encodeURIComponent(job.job_id || "")}`;
  return { title, text, url };
}

export async function shareJob(job) {
  const payload = jobSharePayload(job);

  if (navigator.share) {
    try {
      await navigator.share(payload);
      return { ok: true, method: "native" };
    } catch (err) {
      if (err?.name === "AbortError") return { ok: false, cancelled: true };
      throw err;
    }
  }

  const clip = `${payload.title}\n${payload.url}`;
  await navigator.clipboard.writeText(clip);
  return { ok: true, method: "clipboard" };
}
