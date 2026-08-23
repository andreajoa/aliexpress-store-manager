import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./aliexpress-token-crypto";
import { AliExpressOperationalClient } from "./aliexpress-operational-client";
import { aliExpressConfig, refreshAliExpressToken } from "./aliexpress-oauth";

export {
  aliExpressConfig,
  buildAliExpressAuthorizeUrl,
  exchangeAliExpressCode,
  tokenExpiryFromResponse,
} from "./aliexpress-oauth";

export async function saveAliExpressConnection(input: {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt: Date;
  refreshExpiresAt?: Date | null;
  userId?: string | null;
  userNick?: string | null;
}) {
  const encrypted = encryptSecret(input.accessToken);
  const refreshEncrypted = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : null;

  return prisma.aliExpressConnection.upsert({
    where: { id: "primary" },
    create: {
      id: "primary",
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.authTag,
      refreshTokenCiphertext: refreshEncrypted?.ciphertext || null,
      refreshTokenIv: refreshEncrypted?.iv || null,
      refreshTokenTag: refreshEncrypted?.authTag || null,
      refreshExpiresAt: input.refreshExpiresAt || null,
      userId: input.userId || null,
      userNick: input.userNick || null,
      expiresAt: input.expiresAt,
      authorizedAt: new Date(),
    },
    update: {
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.authTag,
      refreshTokenCiphertext: refreshEncrypted?.ciphertext || null,
      refreshTokenIv: refreshEncrypted?.iv || null,
      refreshTokenTag: refreshEncrypted?.authTag || null,
      refreshExpiresAt: input.refreshExpiresAt || null,
      userId: input.userId || null,
      userNick: input.userNick || null,
      expiresAt: input.expiresAt,
      authorizedAt: new Date(),
    },
    select: {
      id: true,
      userId: true,
      userNick: true,
      expiresAt: true,
      authorizedAt: true,
    },
  });
}

export async function aliExpressConnectionStatus() {
  const connection = await prisma.aliExpressConnection.findUnique({
    where: { id: "primary" },
    select: { userId: true, userNick: true, expiresAt: true, authorizedAt: true },
  });
  if (!connection) return { connected: false, expired: false, needsReauthorization: false, connection: null };
  const expired = connection.expiresAt.getTime() <= Date.now();
  const needsReauthorization = connection.expiresAt.getTime() <= Date.now() + 3 * 24 * 60 * 60 * 1000;
  return { connected: !expired, expired, needsReauthorization, connection };
}

async function tryAutoRefresh(): Promise<boolean> {
  const connection = await prisma.aliExpressConnection.findUnique({
    where: { id: "primary" },
  });
  if (!connection) return false;

  // Sem refresh token salvo, não tem como renovar.
  if (!connection.refreshTokenCiphertext || !connection.refreshTokenIv || !connection.refreshTokenTag) {
    return false;
  }

  // Refresh token expirado — precisa re-autorizar manualmente.
  if (connection.refreshExpiresAt && connection.refreshExpiresAt.getTime() <= Date.now()) {
    return false;
  }

  try {
    const refreshToken = decryptSecret({
      ciphertext: connection.refreshTokenCiphertext,
      iv: connection.refreshTokenIv,
      authTag: connection.refreshTokenTag,
    });

    const result = await refreshAliExpressToken({ refreshToken });
    await saveAliExpressConnection({
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresAt: result.expiresAt,
      refreshExpiresAt: result.refreshExpiresAt,
      userId: result.userId || connection.userId,
      userNick: result.userNick || connection.userNick,
    });

    console.info("[AliExpress connection] Token renovado automaticamente.", {
      expiresAt: result.expiresAt.toISOString(),
    });
    return true;
  } catch (error) {
    console.warn("[AliExpress connection] Auto-refresh falhou:", error);
    return false;
  }
}

export async function requireAliExpressSession() {
  const connection = await prisma.aliExpressConnection.findUnique({ where: { id: "primary" } });
  if (!connection) throw new Error("Conta AliExpress ainda não autorizada.");

  // Se o token expirou ou está prestes a expirar, tenta renovar automaticamente.
  if (connection.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000) {
    const refreshed = await tryAutoRefresh();
    if (!refreshed) {
      throw new Error("Autorização AliExpress expirada. Autorize novamente em Configurações → AliExpress.");
    }
    // Re-lê a conexão com o token novo.
    const updated = await prisma.aliExpressConnection.findUnique({ where: { id: "primary" } });
    if (!updated || updated.expiresAt.getTime() <= Date.now()) {
      throw new Error("Autorização AliExpress expirada após tentativa de renovação.");
    }
    const session = decryptSecret({
      ciphertext: updated.accessTokenCiphertext,
      iv: updated.accessTokenIv,
      authTag: updated.accessTokenTag,
    });
    const config = aliExpressConfig();
    return {
      session,
      connection: updated,
      client: new AliExpressOperationalClient({ appKey: config.appKey, appSecret: config.appSecret }),
    };
  }

  const session = decryptSecret({
    ciphertext: connection.accessTokenCiphertext,
    iv: connection.accessTokenIv,
    authTag: connection.accessTokenTag,
  });
  const config = aliExpressConfig();
  return {
    session,
    connection,
    client: new AliExpressOperationalClient({ appKey: config.appKey, appSecret: config.appSecret }),
  };
}

export async function disconnectAliExpress() {
  await prisma.aliExpressConnection.deleteMany({ where: { id: "primary" } });
}
