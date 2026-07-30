import { PrismaClient } from "@prisma/client";
import { seedBuiltInPersonas } from "../src/lib/builtInPersonas";

const prisma = new PrismaClient();

async function main() {
  console.log("Seeding built-in personas...");
  const seededCount = await seedBuiltInPersonas(prisma);
  console.log(`Seeded ${seededCount} personas`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
