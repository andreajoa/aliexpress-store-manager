import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "smwh_";

export function createStoreWebhookToken() {
  return `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashStoreWebhookToken(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function verifySharedWebhookToken(token: string, expectedHash: string | null | undefined) {
  if (!token || !expectedHash || !/^[a-f0-9]{64}$/i.test(expectedHash)) {
    return false;
  }

  const actual = Buffer.from(hashStoreWebhookToken(token), "hex");
  const expected = Buffer.from(expectedHash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function verifyStoreWebhookToken(token: string, expectedHash: string | null | undefined) {
  return token.startsWith(TOKEN_PREFIX) && verifySharedWebhookToken(token, expectedHash);
}

export function bearerToken(request: Request) {
  const authorization = request.headers.get("authorization") || "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}
