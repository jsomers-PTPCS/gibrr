-- CreateTable
CREATE TABLE "ProfileMemo" (
    "id" TEXT NOT NULL,
    "authorActorId" TEXT NOT NULL,
    "subjectActorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfileMemo_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileMemo_authorActorId_subjectActorId_key" ON "ProfileMemo"("authorActorId", "subjectActorId");

-- AddForeignKey
ALTER TABLE "ProfileMemo" ADD CONSTRAINT "ProfileMemo_authorActorId_fkey" FOREIGN KEY ("authorActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileMemo" ADD CONSTRAINT "ProfileMemo_subjectActorId_fkey" FOREIGN KEY ("subjectActorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

