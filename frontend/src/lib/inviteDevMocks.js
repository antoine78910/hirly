import axios from "axios";
import { parseApiPath } from "./apiPath";

/** Fixed local invite codes — must stay in sync with backend DEV_TEST_INVITE_SPECS. */
export const DEV_INVITE_CODES = {
  "123456": {
    valid: true,
    reason: null,
    influencer_name: "Formation Hirly",
    course_id: "course_job_search_mastery",
    invite_type: "training",
    already_redeemed: false,
  },
  "654321": {
    valid: true,
    reason: null,
    influencer_name: "Démo Hirly",
    course_id: "course_job_search_mastery",
    invite_type: "demo",
    already_redeemed: false,
  },
};

export function getLocalDevInviteMeta(code) {
  const normalized = String(code || "").trim();
  return DEV_INVITE_CODES[normalized] || null;
}

function redeemDevInvite(code) {
  const meta = getLocalDevInviteMeta(code);
  if (!meta) return undefined;
  const inviteType = meta.invite_type;
  return {
    ok: true,
    code,
    invite_type: inviteType,
    demo_account: inviteType === "demo" || inviteType === "creator",
    training_access: inviteType === "training" || inviteType === "creator",
    course_id: meta.course_id,
    enrollment_id: inviteType === "training" ? "dev_enrollment" : undefined,
  };
}

/** Mock invite validate/redeem for known dev codes when the API is unavailable. */
export function getInviteDevResponse(config) {
  if (process.env.NODE_ENV !== "development") return undefined;

  const method = (config.method || "get").toLowerCase();
  let requestUrl = config.url || "";
  try {
    requestUrl = axios.getUri(config);
  } catch {
    /* use config.url */
  }
  const { path } = parseApiPath(requestUrl);

  const validateMatch = path.match(/^\/invites\/(\d{6})\/validate$/);
  if (method === "get" && validateMatch) {
    const code = validateMatch[1];
    const meta = getLocalDevInviteMeta(code);
    if (!meta) return undefined;
    return meta;
  }

  if (method === "post" && path === "/invites/redeem") {
    const body = typeof config.data === "string" ? JSON.parse(config.data) : config.data;
    const code = String(body?.code || "").trim();
    return redeemDevInvite(code);
  }

  return undefined;
}
