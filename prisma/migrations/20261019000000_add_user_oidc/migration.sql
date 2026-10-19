-- 统一登录（Casdoor OIDC）：用户绑定的 sub（可空、唯一）与显示名。只加列，不动已有数据。
-- AlterTable
ALTER TABLE "User" ADD COLUMN "oidcSub" TEXT;
ALTER TABLE "User" ADD COLUMN "oidcName" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_oidcSub_key" ON "User"("oidcSub");
