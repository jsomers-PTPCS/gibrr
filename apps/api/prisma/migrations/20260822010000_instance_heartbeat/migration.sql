-- CreateTable
CREATE TABLE "InstanceHeartbeat" (
    "id" INTEGER NOT NULL,
    "lastAliveAt" TIMESTAMP(3) NOT NULL,
    "lastDowntimeAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstanceHeartbeat_pkey" PRIMARY KEY ("id")
);

