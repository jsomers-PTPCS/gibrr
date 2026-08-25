-- CreateTable
CREATE TABLE "StarterPack" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "memberActorIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StarterPack_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StarterPack" ADD CONSTRAINT "StarterPack_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
