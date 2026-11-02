const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();
p.pipelineStep
  .findMany({
    where: { pipelineId: "cmvumepns0004sxu2zugwe95g" },
    orderBy: { order: "asc" },
    select: { name: true, type: true, status: true, error: true },
  })
  .then((r) => {
    console.log(JSON.stringify(r, null, 2));
    return p.$disconnect();
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });