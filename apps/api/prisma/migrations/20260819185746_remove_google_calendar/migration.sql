/*
  Warnings:

  - You are about to drop the column `accessToken` on the `CalendarConnection` table. All the data in the column will be lost.
  - You are about to drop the column `googleCalendarId` on the `CalendarConnection` table. All the data in the column will be lost.
  - You are about to drop the column `refreshToken` on the `CalendarConnection` table. All the data in the column will be lost.
  - You are about to drop the column `tokenExpiresAt` on the `CalendarConnection` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "CalendarConnection" DROP COLUMN "accessToken",
DROP COLUMN "googleCalendarId",
DROP COLUMN "refreshToken",
DROP COLUMN "tokenExpiresAt";
