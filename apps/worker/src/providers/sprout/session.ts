import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export interface SproutSession {
  accessToken: string;
  refreshToken: string;
}

export interface PersistedSproutSession {
  version: bigint;
  ciphertext: string;
}

/**
 * Encrypts the rotating third-party session before it reaches PostgreSQL.
 * The database only stores a versioned opaque blob; the key stays in worker
 * configuration and must never be included in logs or error ledgers.
 */
export class SproutSessionCipher {
  private constructor(private readonly key: Buffer) {}

  static fromEnvironment(value: string | undefined): SproutSessionCipher | null {
    const encoded = value?.trim();
    if (!encoded) return null;
    let key: Buffer;
    try {
      key = Buffer.from(encoded, "base64");
    } catch {
      throw new Error("sprout_session_encryption_key_invalid");
    }
    if (key.length !== 32) throw new Error("sprout_session_encryption_key_invalid");
    return new SproutSessionCipher(key);
  }

  encrypt(session: SproutSession): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const plaintext = Buffer.from(JSON.stringify(session), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ciphertext]).toString("base64");
  }

  decrypt(encoded: string): SproutSession {
    let payload: Buffer;
    try {
      payload = Buffer.from(encoded, "base64");
      if (payload.length < 29) throw new Error("payload too short");
      const iv = payload.subarray(0, 12);
      const tag = payload.subarray(12, 28);
      const ciphertext = payload.subarray(28);
      const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
      decipher.setAuthTag(tag);
      const decoded = JSON.parse(
        Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8"),
      ) as Partial<SproutSession>;
      if (
        typeof decoded.accessToken !== "string" ||
        !decoded.accessToken.trim() ||
        typeof decoded.refreshToken !== "string" ||
        !decoded.refreshToken.trim()
      ) {
        throw new Error("invalid session");
      }
      return { accessToken: decoded.accessToken.trim(), refreshToken: decoded.refreshToken.trim() };
    } catch {
      throw new Error("sprout_persisted_session_invalid");
    }
  }
}
