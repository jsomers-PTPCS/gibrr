-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'failed');

-- CreateTable
CREATE TABLE "OutboundDelivery" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "inboxUrl" TEXT NOT NULL,
    "activity" JSONB NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutboundDelivery_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "OutboundDelivery" ADD CONSTRAINT "OutboundDelivery_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

