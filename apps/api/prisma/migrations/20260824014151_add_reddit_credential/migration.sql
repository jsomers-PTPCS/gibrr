-- CreateTable
CREATE TABLE "RedditCredential" (
    "id" INTEGER NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientSecret" TEXT NOT NULL,
    "accessToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),

    CONSTRAINT "RedditCredential_pkey" PRIMARY KEY ("id")
);
