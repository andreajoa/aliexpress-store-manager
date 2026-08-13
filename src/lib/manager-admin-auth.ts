export type ManagerAdminCredentials = {
  username: string;
  password: string;
};

function safeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  const max = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;
  for (let index = 0; index < max; index++) {
    diff |= (left[index] || 0) ^ (right[index] || 0);
  }
  return diff === 0;
}

export function managerAdminCredentialsFromEnv(env: Record<string, string | undefined>) {
  const username = env.MANAGER_ADMIN_USER?.trim() || "";
  const password = env.MANAGER_ADMIN_PASSWORD || "";
  return username && password ? { username, password } : null;
}

export function parseBasicAuthorization(value: string | null) {
  if (!value) return null;
  const match = value.match(/^Basic\s+(.+)$/i);
  if (!match) return null;

  try {
    const decoded = atob(match[1]);
    const separator = decoded.indexOf(":");
    if (separator < 0) return null;
    return {
      username: decoded.slice(0, separator),
      password: decoded.slice(separator + 1),
    };
  } catch {
    return null;
  }
}

export function verifyManagerAdminAuthorization(
  authorization: string | null,
  expected: ManagerAdminCredentials,
) {
  const parsed = parseBasicAuthorization(authorization);
  if (!parsed) return false;
  const usernameMatches = safeEqual(parsed.username, expected.username);
  const passwordMatches = safeEqual(parsed.password, expected.password);
  return usernameMatches && passwordMatches;
}

export function isPublicManagerPath(pathname: string) {
  if (pathname === "/api/health") return true;
  if (pathname === "/api/aliexpress/oauth/callback") return true;
  if (pathname === "/api/cron/maintenance") return true;
  if (/^\/api\/stores\/[^/]+\/orders\/webhook\/?$/.test(pathname)) return true;
  if (/^\/api\/stores\/[^/]+\/amb\/orders\/webhook\/?$/.test(pathname)) return true;
  if (/^\/api\/stores\/[^/]+\/inventory\/reservations\/?$/.test(pathname)) return true;
  if (pathname.startsWith("/_next/static/") || pathname.startsWith("/_next/image/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/robots.txt") return true;
  return false;
}
