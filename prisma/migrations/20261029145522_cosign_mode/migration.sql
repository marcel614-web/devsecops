-- CreateEnum
CREATE TYPE "CosignMode" AS ENUM ('DISABLED', 'WARNING', 'REQUIRED');

-- AlterTable
ALTER TABLE "ProjectConfiguration" ADD COLUMN     "cosignMode" "CosignMode" NOT NULL DEFAULT 'DISABLED';
