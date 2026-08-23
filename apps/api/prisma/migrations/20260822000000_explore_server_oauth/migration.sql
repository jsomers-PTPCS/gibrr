-- AlterTable
ALTER TABLE "ExploreServer" ADD COLUMN     "oauthAccessToken" TEXT,
ADD COLUMN     "oauthClientId" TEXT,
ADD COLUMN     "oauthClientSecret" TEXT,
ADD COLUMN     "oauthPendingState" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ExploreServer_oauthPendingState_key" ON "ExploreServer"("oauthPendingState");

