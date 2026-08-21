-- CreateTable
CREATE TABLE "CalendarEventSave" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarEventSave_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarEventSave_actorId_postId_key" ON "CalendarEventSave"("actorId", "postId");

-- AddForeignKey
ALTER TABLE "CalendarEventSave" ADD CONSTRAINT "CalendarEventSave_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CalendarEventSave" ADD CONSTRAINT "CalendarEventSave_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
