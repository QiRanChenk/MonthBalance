import prisma from "~/lib/prisma";

/**
 * @swagger
 * /api/entry/flow/type/getIndustryType:
 *   post:
 *     summary: 获取行业类型列表
 *     tags: ["Flow Type"]
 *     security:
 *       - Authorization: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             bookId: string 账本ID
 *             flowType: string 流水类型（可选）
 *     responses:
 *       200:
 *         description: 行业类型列表获取成功
 *         content:
 *           application/json:
 *             schema:
 *               Result:
 *                 d: [] # {industryType: 行业类型名称}
 *       400:
 *         description: 获取失败
 *         content:
 *           application/json:
 *             schema:
 *               Error: {
 *                 message: "请先选择账本"
 *               }
 */
export default defineEventHandler(async (event) => {
  const { bookId, flowType } = await readBody(event); // 获取查询参数

  if (!bookId) {
    return error("请先选择账本");
  }
  const where: any = {
    bookId,
  }; // 条件查询

  if (flowType) {
    where.flowType = {
      equals: flowType,
    };
  }

  // groupBy 走 SQL 级去重，避免拉全量
  const groups = await prisma.flow.groupBy({
    by: ["industryType"],
    orderBy: [
      {
        industryType: "asc",
      },
    ],
    where, // 使用条件查询
  });

  return success(groups.map((g) => ({ industryType: g.industryType })));
});
