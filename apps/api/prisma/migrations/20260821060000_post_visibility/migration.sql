-- CreateEnum
CREATE TYPE "PostVisibility" AS ENUM ('public', 'followers', 'specified', 'local_only');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "visibility" "PostVisibility" NOT NULL DEFAULT 'public';

-- CreateTable
CREATE TABLE "PostRecipient" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,

    CONSTRAINT "PostRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PostRecipient_postId_actorId_key" ON "PostRecipient"("postId", "actorId");

-- AddForeignKey
ALTER TABLE "PostRecipient" ADD CONSTRAINT "PostRecipient_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostRecipient" ADD CONSTRAINT "PostRecipient_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

