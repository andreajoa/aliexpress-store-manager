import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

function encryptionKey(env: Record<string, string | undefined> = process.env) {
  const encoded = env.ALIEXPRESS_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("ALIEXPRESS_TOKEN_ENCRYPTION_KEY não configurada.");

  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) {
    throw new Error("ALIEXPRESS_TOKEN_ENCRYPTION_KEY deve ser uma chave Base64 de 32 bytes.");
  }
  return key;
}

export function encryptSecret(
  plaintext: string,
  env: Record<string, string | undefined> = process.env,
): EncryptedSecret {
  if (!plaintext) throw new Error("Segredo vazio não pode ser persistido.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(env), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
  };
}

export function decryptSecret(
  encrypted: EncryptedSecret,
  env: Record<string, string | undefined> = process.env,
) {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(env),
    Buffer.from(encrypted.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
