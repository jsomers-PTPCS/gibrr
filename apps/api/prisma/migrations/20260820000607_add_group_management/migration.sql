-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "privacy" TEXT NOT NULL DEFAULT 'public';

-- AlterTable
ALTER TABLE "CommunityMembership" ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'member',
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'accepted';

