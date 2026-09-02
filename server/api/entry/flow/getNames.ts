import prisma from "~/lib/prisma";

/**
 * @swagger
 * /api/entry/flow/getNames:
 *   post:
 *     summary: 获取流水名称列表
 *     tags: ["Flow"]
 *     security:
 *       - Authorization: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             bookId: string 账本ID
 *     responses:
 *       200:
 *         description: 流水名称列表获取成功
 *         content:
 *           application/json:
 *             schema:
 *               Result:
 *                 d: [] #[string流水名称数组]
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
  const { bookId } = await readBody(event);

  if (!bookId) {
    return error("请先选择账本");
  }

  const where: any = {
    bookId,
  };

  // groupBy 走 SQL 级 GROUP BY 去重；findMany+distinct 是 Prisma 拉全量后内存去重，数据多时极慢
  const flows = await prisma.flow.groupBy({
    by: ["name"],
    orderBy: [
      {
        name: "asc",
      },
    ],
    where,
  });

  const names = flows
    .map((flow) => flow.name)
    .filter((name) => name && name.trim() !== "");

  return success(names);
});
