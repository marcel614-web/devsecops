const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.pipeline
  .findMany({
    orderBy: { createdAt: "desc" },
    take: 3,
    select: { id: true, status: true, createdAt: true },
  })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });