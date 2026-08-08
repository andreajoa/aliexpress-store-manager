export type AliExpressOpenPlatformConfig = {
  appKey: string;
  appSecret: string;
  redirectUri: string;
};

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
  const url = new URL("https://oauth.aliexpress.com/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.appKey);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("view", "web");
  url.searchParams.set("sp", "ae");
  return url.toString();
}

export type AliExpressTokenResponse = {
  access_token?: unknown;
  expire_time?: unknown;
  expires_in?: unknown;
  user_id?: unknown;
  user_nick?: unknown;
  error?: unknown;
  error_description?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

export function tokenExpiryFromResponse(response: AliExpressTokenResponse, now = Date.now()) {
  const expireTime = Number(response.expire_time);
  if (Number.isFinite(expireTime) && expireTime > now) return new Date(expireTime);
  const expiresIn = Number(response.expires_in);
  if (Number.isFinite(expiresIn) && expiresIn > 0) return new Date(now + expiresIn * 1000);
  throw new Error("AliExpress não retornou uma validade utilizável para o access token.");
}

export async function exchangeAliExpressCode(input: {
  code: string;
  env?: Record<string, string | undefined>;
  fetchImpl?: typeof fetch;
}) {
  const config = aliExpressConfig(input.env);
  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl("https://oauth.aliexpress.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=utf-8" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: input.code,
      client_id: config.appKey,
      client_secret: config.appSecret,
      redirect_uri: config.redirectUri,
      sp: "ae",
    }),
    cache: "no-store",
  });
  const payload = await response.json() as AliExpressTokenResponse;
  const accessToken = text(payload.access_token);
  if (!response.ok || !accessToken) {
    throw new Error(text(payload.error_description || payload.error) || `Falha OAuth AliExpress (HTTP ${response.status}).`);
  }
  return {
    accessToken,
    expiresAt: tokenExpiryFromResponse(payload),
    userId: text(payload.user_id) || null,
    userNick: text(payload.user_nick) || null,
  };
}
