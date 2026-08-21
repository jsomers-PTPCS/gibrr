-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "eventEnd" TIMESTAMP(3),
ADD COLUMN     "eventLocation" TEXT,
ADD COLUMN     "eventStart" TIMESTAMP(3);
