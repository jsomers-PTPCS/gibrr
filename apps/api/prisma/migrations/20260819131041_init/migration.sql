-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('Person', 'Group');

-- CreateEnum
CREATE TYPE "FollowState" AS ENUM ('pending', 'accepted');

-- CreateTable
CREATE TABLE "Actor" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "type" "ActorType" NOT NULL DEFAULT 'Person',
    "displayName" TEXT,
    "summary" TEXT,
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT,
    "inboxUrl" TEXT NOT NULL,
    "outboxUrl" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Actor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Follow" (
    "id" TEXT NOT NULL,
    "followerId" TEXT NOT NULL,
    "followingId" TEXT NOT NULL,
    "state" "FollowState" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Follow_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Actor_username_domain_key" ON "Actor"("username", "domain");

-- CreateIndex
CREATE UNIQUE INDEX "Follow_followerId_followingId_key" ON "Follow"("followerId", "followingId");

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followerId_fkey" FOREIGN KEY ("followerId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_followingId_fkey" FOREIGN KEY ("followingId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
