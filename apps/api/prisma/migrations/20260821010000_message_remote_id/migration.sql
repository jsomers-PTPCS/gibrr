-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "remoteId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Message_remoteId_key" ON "Message"("remoteId");

