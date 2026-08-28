-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'followed_post';

-- AlterTable
ALTER TABLE "Follow" ADD COLUMN     "notifyOnPost" BOOLEAN NOT NULL DEFAULT false;
