const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.deployment
  .findMany({
    orderBy: { createdAt: "desc" },
    take: 1,
    select: { id: true, pipelineId: true, status: true, error: true },
  })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });