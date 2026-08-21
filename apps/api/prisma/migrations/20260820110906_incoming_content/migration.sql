-- DropForeignKey
ALTER TABLE "Post" DROP CONSTRAINT "Post_communityId_fkey";

-- AlterTable
ALTER TABLE "Comment" ADD COLUMN     "remoteId" TEXT;

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "remoteId" TEXT,
ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "communityId" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Comment_remoteId_key" ON "Comment"("remoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Post_remoteId_key" ON "Post"("remoteId");

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE SET NULL ON UPDATE CASCADE;

