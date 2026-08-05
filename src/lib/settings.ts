import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { prisma } from "./db";

// Every AppSetting value (API keys, custom instructions, etc.) is encrypted
// at rest with AES-256-GCM. The key is derived from AUTH_SECRET (already a
// required env var for this app) so there's no new setup step. Values
// written before this was added have no ENC_PREFIX and are returned as-is —
// they get encrypted the next time they're saved.
const ENC_PREFIX = "enc:v1:";

function getEncryptionKey(): Buffer {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET must be set to store or read app settings");
  }
  return createHash("sha256").update(`devchat:appsetting:${secret}`).digest();
}

function encryptValue(value: string): string {
  const key = getEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return ENC_PREFIX + Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

function decryptValue(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored;
  const key = getEncryptionKey();
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const ciphertext = raw.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}

export async function getSettingsKey(userId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { userId_key: { userId, key } } });
  if (!row?.value) return null;
  return decryptValue(row.value);
}

export async function setSettingsKey(userId: string, key: string, value: string): Promise<void> {
  const encrypted = encryptValue(value);
  await prisma.appSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value: encrypted },
    create: { userId, key, value: encrypted },
  });
}

export async function deleteSettingsKey(userId: string, key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { userId, key } });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 3) + "•".repeat(key.length - 6) + key.slice(-3);
}
