import { prisma } from "./db";

export async function getSettingsKey(key: string): Promise<string | null> {
  const row = await prisma.appSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export async function setSettingsKey(key: string, value: string): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value },
    create: { key, value },
  });
}

export async function deleteSettingsKey(key: string): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key } });
}

export function maskKey(key: string): string {
  if (key.length <= 8) return "•".repeat(key.length);
  return key.slice(0, 3) + "•".repeat(key.length - 6) + key.slice(-3);
}
