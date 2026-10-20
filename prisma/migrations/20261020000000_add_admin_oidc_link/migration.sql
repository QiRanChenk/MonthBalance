-- 统一登录：后台管理员绑定的 Casdoor 账号（最多一行）。只新建表，不动已有数据。
-- CreateTable
CREATE TABLE "AdminOidcLink" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "sub" TEXT NOT NULL,
    "name" TEXT,
    "createDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
