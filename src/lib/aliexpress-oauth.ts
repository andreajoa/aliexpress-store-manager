import { createHmac } from "node:crypto";

export type AliExpressOpenPlatformConfig = {
  appKey: string;
  appSecret: string;
  redirectUri: string;
};

const ALIEXPRESS_AUTH_BASE_URL = "https://api-sg.aliexpress.com";
const ALIEXPRESS_TOKEN_API = "/auth/token/create";

export function aliExpressConfig(
  env: Record<string, string | undefined> = process.env,
): AliExpressOpenPlatformConfig {
  const appKey = env.ALIEXPRESS_APP_KEY?.trim() || "";
  const appSecret = env.ALIEXPRESS_APP_SECRET?.trim() || "";
  const redirectUri = env.ALIEXPRESS_OAUTH_REDIRECT_URI?.trim() || "";
  if (!appKey || !appSecret || !redirectUri) {
    throw new Error("AliExpress Open Platform não está configurado.");
  }
  return { appKey, appSecret, redirectUri };
}

export function buildAliExpressAuthorizeUrl(input: {
  state: string;
  env?: Record<string, string | undefined>;
}) {
  const config = aliExpressConfig(input.env);
  const url = new URL(`${ALIEXPRESS_AUTH_BASE_URL}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("force_auth", "true");
  url.searchParams.set("client_id", config.appKey);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", input.state);
  return url.toString();
}

export type AliExpressTokenResponse = {
  code?: unknown;
  access_token?: unknown;
  refresh_token?: unknown;
  expire_time?: unknown;
  expires_in?: unknown;
  refresh_expires_in?: unknown;
  user_id?: unknown;
  user_Id?: unknown;
  user_nick?: unknown;
  account_id?: unknown;
  account?: unknown;
  seller_Id?: unknown;
  error?: unknown;
  error_code?: unknown;
  error_description?: unknown;
  message?: unknown;
};

function text(value: unknown) {
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}

function signIopRequest(
  apiName: string,
  params: Record<string, string>,
  appSecret: string,
) {
  const base = apiName + Object.keys(params)
    .sort()
    .map((key) => `${key}${params[key]}`)
    .join("");

  return createHmac("sha256", appSecret)
    .update(base, "utf8")
    .digest("hex")
    .toUpperCase();
}

export function tokenExpiryFromResponse(response: AliExpressTokenResponse, now = Date.now()) {
  const expireTime = Number(response.expire_time);
  if (Number.isFinite(expireTime) && expireTime > now) return new Date(expireTime);

  const expiresIn = Number(response.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) {
    return new Date(now + expiresIn * 1000);
  }

  throw new Error("AliExpress não retornou uma validade utilizável para o access token.");
}

export async function exchangeAliExpressCode(input: {
  code: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  const config = aliExpressConfig(input.env);
  const fetchImpl = input.fetchImpl || fetch;

  const params: Record<string, string> = {
    app_key: config.appKey,
    code: input.code,
    sign_method: "sha256",
    timestamp: String(Date.now()),
  };
  const sign = signIopRequest(ALIEXPRESS_TOKEN_API, params, config.appSecret);

  const url = new URL(`${ALIEXPRESS_AUTH_BASE_URL}/rest${ALIEXPRESS_TOKEN_API}`);
  for (const [key, value] of Object.entries({ ...params, sign })) {
    url.searchParams.set(key, value);
  }

  const response = await fetchImpl(url, {
    method: "GET",
    cache: "no-store",
  });
  const payload = await response.json() as AliExpressTokenResponse;
  const accessToken = text(payload.access_token);

  if (!response.ok || !accessToken) {
    const errorMessage = text(
      payload.error_description ||
      payload.message ||
      payload.error ||
      payload.error_code,
    );
    throw new Error(errorMessage || `Falha OAuth AliExpress (HTTP ${response.status}).`);
  }

  return {
    accessToken,
    expiresAt: tokenExpiryFromResponse(payload),
    userId: text(
      payload.user_Id ||
      payload.user_id ||
      payload.account_id ||
      payload.seller_Id,
    ) || null,
    userNick: text(payload.account || payload.user_nick) || null,
  };
}
