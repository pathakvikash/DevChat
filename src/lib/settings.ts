import { prisma } from "./db";

export async function getSettingsKey(userId: string, key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { userId_key: { userId, key } } });
  return row?.value ?? null;
}

export async function setSettingsKey(userId: string, key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { userId_key: { userId, key } },
    update: { value },
    create: { userId, key, value },
  });
}

export async function deleteSettingsKey(userId: string, key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { userId, key } });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 3) + "•".repeat(key.length - 6) + key.slice(-3);
}
