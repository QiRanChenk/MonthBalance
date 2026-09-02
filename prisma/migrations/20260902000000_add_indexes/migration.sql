-- CreateIndex
CREATE INDEX IF NOT EXISTS "Book_userId_idx" ON "Book"("userId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Book_bookId_idx" ON "Book"("bookId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Flow_bookId_day_idx" ON "Flow"("bookId", "day");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Flow_bookId_flowType_day_idx" ON "Flow"("bookId", "flowType", "day");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Flow_bookId_industryType_idx" ON "Flow"("bookId", "industryType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Flow_bookId_payType_idx" ON "Flow"("bookId", "payType");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Flow_bookId_attribution_idx" ON "Flow"("bookId", "attribution");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Flow_bookId_money_idx" ON "Flow"("bookId", "money");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Budget_bookId_month_idx" ON "Budget"("bookId", "month");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Receivable_bookId_status_idx" ON "Receivable"("bookId", "status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "FixedFlow_bookId_month_idx" ON "FixedFlow"("bookId", "month");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TypeRelation_bookId_idx" ON "TypeRelation"("bookId");
