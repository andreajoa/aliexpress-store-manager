import { prisma } from "./prisma";
import { decryptSecret, encryptSecret } from "./aliexpress-token-crypto";
import { AliExpressTopClient } from "./aliexpress-top-client";
import {
  aliExpressConfig,
  buildAliExpressAuthorizeUrl,
  exchangeAliExpressCode,
  tokenExpiryFromResponse,
} from "./aliexpress-oauth";

export {
  aliExpressConfig,
  buildAliExpressAuthorizeUrl,
  exchangeAliExpressCode,
  tokenExpiryFromResponse,
} from "./aliexpress-oauth";

export async function saveAliExpressConnection(input: {
  accessToken: string;
  expiresAt: Date;
  userId?: string | null;
  userNick?: string | null;
}) {
  const encrypted = encryptSecret(input.accessToken);
  return prisma.aliExpressConnection.upsert({
    where: { id: "primary" },
    create: {
      id: "primary",
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.authTag,
      userId: input.userId || null,
      userNick: input.userNick || null,
      expiresAt: input.expiresAt,
      authorizedAt: new Date(),
    },
    update: {
      accessTokenCiphertext: encrypted.ciphertext,
      accessTokenIv: encrypted.iv,
      accessTokenTag: encrypted.authTag,
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

export async function requireAliExpressSession() {
  const connection = await prisma.aliExpressConnection.findUnique({ where: { id: "primary" } });
  if (!connection) throw new Error("Conta AliExpress ainda não autorizada.");
  if (connection.expiresAt.getTime() <= Date.now() + 5 * 60 * 1000) {
    throw new Error("Autorização AliExpress expirada ou próxima de expirar. Autorize novamente.");
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
    client: new AliExpressTopClient({ appKey: config.appKey, appSecret: config.appSecret }),
  };
}

export async function disconnectAliExpress() {
  await prisma.aliExpressConnection.deleteMany({ where: { id: "primary" } });
}
