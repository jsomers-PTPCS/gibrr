-- CreateTable
CREATE TABLE "GhostBlog" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GhostBlog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GhostSubscription" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "blogId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GhostSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GhostBlog_domain_key" ON "GhostBlog"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "GhostSubscription_actorId_blogId_key" ON "GhostSubscription"("actorId", "blogId");

-- AddForeignKey
ALTER TABLE "GhostSubscription" ADD CONSTRAINT "GhostSubscription_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GhostSubscription" ADD CONSTRAINT "GhostSubscription_blogId_fkey" FOREIGN KEY ("blogId") REFERENCES "GhostBlog"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
