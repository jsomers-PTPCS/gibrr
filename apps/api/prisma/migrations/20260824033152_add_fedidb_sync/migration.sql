-- AlterTable
ALTER TABLE "ExploreServer" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'manual';

-- CreateTable
CREATE TABLE "FediDbSyncSettings" (
    "id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "minUserCount" INTEGER NOT NULL DEFAULT 10000,
    "lastSyncAt" TIMESTAMP(3),

    CONSTRAINT "FediDbSyncSettings_pkey" PRIMARY KEY ("id")
);
