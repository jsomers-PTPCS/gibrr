-- AlterTable
ALTER TABLE "LocalUser" ADD COLUMN     "emailVerificationExpiresAt" TIMESTAMP(3),
ADD COLUMN     "emailVerificationToken" TEXT,
ADD COLUMN     "emailVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "passwordResetExpiresAt" TIMESTAMP(3),
ADD COLUMN     "passwordResetToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "LocalUser_emailVerificationToken_key" ON "LocalUser"("emailVerificationToken");

-- CreateIndex
CREATE UNIQUE INDEX "LocalUser_passwordResetToken_key" ON "LocalUser"("passwordResetToken");

