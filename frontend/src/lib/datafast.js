/** DataFast attribution cookies for Stripe checkout metadata (revenue attribution). */

function readCookie(name) {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(new RegExp(`(?:^|; )${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : "";
}

/** Return DataFast IDs to send with server-side Stripe Checkout creation. */
export function getDatafastAttribution() {
  const datafast_visitor_id = readCookie("datafast_visitor_id");
  const datafast_session_id = readCookie("datafast_session_id");
  const payload = {};
  if (datafast_visitor_id) payload.datafast_visitor_id = datafast_visitor_id;
  if (datafast_session_id) payload.datafast_session_id = datafast_session_id;
  return payload;
}

/** Merge DataFast attribution into a checkout session request body. */
export function withDatafastAttribution(body = {}) {
  return { ...body, ...getDatafastAttribution() };
}
