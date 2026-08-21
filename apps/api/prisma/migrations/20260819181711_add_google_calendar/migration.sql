-- AlterTable
ALTER TABLE "CalendarConnection" ADD COLUMN     "accessToken" TEXT,
ADD COLUMN     "googleCalendarId" TEXT,
ADD COLUMN     "refreshToken" TEXT,
ADD COLUMN     "tokenExpiresAt" TIMESTAMP(3),
ALTER COLUMN "serverUrl" DROP NOT NULL,
ALTER COLUMN "username" DROP NOT NULL,
ALTER COLUMN "appPassword" DROP NOT NULL;
