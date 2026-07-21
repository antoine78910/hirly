import { createHmac, timingSafeEqual } from "node:crypto";
import { isFeedEffectiveQuery, type FeedAuthAssertion } from "@hirly/feed-v2";
import type { FeedAuthAssertionVerifier } from "./index";

const ASSERTION_HEADER = "x-hirly-feed-assertion";
const SIGNATURE_HEADER = "x-hirly-feed-signature";

function validAssertion(value: unknown): value is FeedAuthAssertion {
  if (!value || typeof value !== "object") return false;
  const assertion = value as Partial<FeedAuthAssertion>;
  const keys = Object.keys(value).sort().join(",");
  return (keys === "candidateId,expiresAt,issuedAt,scopes,subject"
      || keys === "candidateId,effectiveQuery,expiresAt,issuedAt,scopes,subject")
    && typeof assertion.subject === "string" && assertion.subject.length > 0
    && typeof assertion.candidateId === "string" && assertion.candidateId.length > 0
    && assertion.candidateId.length <= 256
    && Array.isArray(assertion.scopes) && assertion.scopes.length <= 16
    && assertion.scopes.every((scope) => typeof scope === "string" && scope.length > 0 && scope.length <= 64)
    && typeof assertion.issuedAt === "string" && Number.isFinite(Date.parse(assertion.issuedAt))
    && typeof assertion.expiresAt === "string" && Number.isFinite(Date.parse(assertion.expiresAt))
    && (assertion.effectiveQuery === undefined || isFeedEffectiveQuery(assertion.effectiveQuery));
}

function signature(secret: string, encodedAssertion: string): Buffer {
  return createHmac("sha256", secret).update(encodedAssertion).digest();
}

export function signFeedAssertion(assertion: FeedAuthAssertion, secret: string): {
  encodedAssertion: string;
  signature: string;
} {
  if (!validAssertion(assertion)) throw new Error("invalid_assertion_payload");
  const encodedAssertion = Buffer.from(JSON.stringify(assertion), "utf8").toString("base64url");
  return { encodedAssertion, signature: signature(secret, encodedAssertion).toString("hex") };
}

export class HmacFeedAssertionVerifier implements FeedAuthAssertionVerifier {
  constructor(
    private readonly secret: string,
    private readonly options: { now?: () => Date; maximumLifetimeMs?: number } = {},
  ) {
    if (secret.length < 32) throw new Error("FEED_V2_ASSERTION_SECRET must contain at least 32 characters");
  }

  async verify(request: Request): Promise<FeedAuthAssertion> {
    const encoded = request.headers.get(ASSERTION_HEADER);
    const providedHex = request.headers.get(SIGNATURE_HEADER);
    if (!encoded || !providedHex || !/^[a-f0-9]{64}$/i.test(providedHex)) throw new Error("invalid_assertion_signature");
    const expected = signature(this.secret, encoded);
    const provided = Buffer.from(providedHex, "hex");
    if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) throw new Error("invalid_assertion_signature");
    let parsed: unknown;
    try {
      parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new Error("invalid_assertion_payload");
    }
    if (!validAssertion(parsed)) throw new Error("invalid_assertion_payload");
    const now = (this.options.now?.() ?? new Date()).getTime();
    const issuedAt = Date.parse(parsed.issuedAt);
    const expiresAt = Date.parse(parsed.expiresAt);
    if (issuedAt > now + 30_000 || expiresAt <= now || expiresAt <= issuedAt) throw new Error("invalid_assertion_time");
    if (expiresAt - issuedAt > (this.options.maximumLifetimeMs ?? 5 * 60_000)) throw new Error("assertion_lifetime_exceeded");
    return parsed;
  }
}
