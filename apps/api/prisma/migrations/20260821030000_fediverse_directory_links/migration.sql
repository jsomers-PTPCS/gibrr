-- CreateEnum
CREATE TYPE "DirectoryLinkCategory" AS ENUM ('people', 'servers', 'developer');

-- CreateTable
CREATE TABLE "FediverseDirectoryLink" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" "DirectoryLinkCategory" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FediverseDirectoryLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FediverseDirectoryLink_url_key" ON "FediverseDirectoryLink"("url");

-- Seed the 7 directory links previously hardcoded in
-- apps/web/lib/fediverseDirectories.ts, so the move from a static
-- frontend file to admin-managed DB rows doesn't lose anything an
-- admin would otherwise have to re-enter by hand.
INSERT INTO "FediverseDirectoryLink" ("id", "name", "url", "description", "category") VALUES
('910dd39a-263d-4364-ae8b-b78e783b407d', 'Fedi.Directory', 'https://fedi.directory/', 'Human-curated directory of interesting accounts, organized by topic.', 'people'),
('d794d622-380f-47ac-9c6e-276551eb3c20', 'Fediverse.info', 'https://fediverse.info/', 'Opt-in, keyword-searchable directory of people looking for followers.', 'people'),
('063a531d-d3c6-4c78-9399-c841b68af86a', 'FediDB', 'https://fedidb.com/servers', 'Server directory with stats — browse by software (Mastodon, PeerTube, Pixelfed, etc.).', 'servers'),
('d3125fc4-d5db-4f58-bd12-78082874ee7d', 'Fediverse Observer', 'https://fediverse.observer/', 'Live status and stats for fediverse servers, filterable by software type.', 'servers'),
('b2e89208-c8da-4021-a1d9-6bcc030c9306', 'The Federation', 'https://the-federation.info/', 'Statistics hub tracking public ActivityPub-based servers.', 'servers'),
('e4c4f1b9-9b76-4227-b36d-70bbae91f3a0', 'Awesome ActivityPub', 'https://github.com/BasixKOR/awesome-activitypub', 'Curated list of ActivityPub software, libraries, and projects.', 'developer'),
('087cae63-3dcd-46ff-bc36-2de7da95d576', 'SocialHub — Software', 'https://socialhub.activitypub.rocks/c/software/14', 'Community forum for ActivityPub software development discussion.', 'developer');

