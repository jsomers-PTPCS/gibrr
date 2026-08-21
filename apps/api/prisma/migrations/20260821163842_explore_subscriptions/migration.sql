-- CreateTable
CREATE TABLE "ExploreSubscription" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploreCachedPost" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExploreCachedPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ExploreSubscription_actorId_serverId_key" ON "ExploreSubscription"("actorId", "serverId");

-- CreateIndex
CREATE UNIQUE INDEX "ExploreCachedPost_serverId_postId_key" ON "ExploreCachedPost"("serverId", "postId");

-- AddForeignKey
ALTER TABLE "ExploreSubscription" ADD CONSTRAINT "ExploreSubscription_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreSubscription" ADD CONSTRAINT "ExploreSubscription_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "ExploreServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreCachedPost" ADD CONSTRAINT "ExploreCachedPost_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "ExploreServer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploreCachedPost" ADD CONSTRAINT "ExploreCachedPost_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

