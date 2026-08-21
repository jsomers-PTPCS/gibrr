-- AlterTable
ALTER TABLE "Actor" ADD COLUMN     "calendarExportToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Actor_calendarExportToken_key" ON "Actor"("calendarExportToken");
