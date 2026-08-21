-- AlterTable
ALTER TABLE "LocalUser" ADD COLUMN     "isAdmin" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "suspended" BOOLEAN NOT NULL DEFAULT false;

