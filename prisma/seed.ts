// devsecops-platform/prisma/seed.ts
import { PrismaClient, Role } from "@prisma/client";
import argon2 from "argon2";

const prisma = new PrismaClient();

async function main() {
  const email = process.env.ADMIN_EMAIL ?? "admin@devsecops.local";
  const password = process.env.ADMIN_PASSWORD ?? "Admin123!ChangeMe";
  const name = process.env.ADMIN_NAME ?? "Administrateur";

  const passwordHash = await argon2.hash(password, {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  });

  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      name,
      passwordHash,
      role: Role.ADMIN,
    },
  });

  console.log("Admin cree :", admin.email);
  console.log("Mot de passe par defaut :", password);
  console.log("Change-le apres la premiere connexion.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });