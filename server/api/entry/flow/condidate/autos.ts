import prisma from "~/lib/prisma";

/**
 * @swagger
 * /api/entry/flow/condidate/autos:
 *   post:
 *     summary: 自动查找候选平账记录
 *     tags: ["Candidate"]
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
 *         description: 候选记录获取成功
 *         content:
 *           application/json:
 *             schema:
 *               Result:
 *                 d: [] #{ out: Flow 支出记录, in: Flow 收入记录}
 *       400:
 *         description: 获取失败
 *         content:
 *           application/json:
 *             schema:
 *               Error: {
 *                 message: "No Find bookid"
 *               }
 */
// 此处的相似性判断示例：金额完全相等（你可根据业务需要添加金额误差、日期范围等条件）
export default defineEventHandler(async (event) => {
  const body = await readBody(event); // 获取请求体
  if (!body.bookId) {
    return error("No Find bookid");
  }
  // const userId = await getUserId(event);
  // 获取所有未平账的支出数据
  const expenditures = await prisma.flow.findMany({
    where: { flowType: "支出", eliminate: 0, bookId: String(body.bookId) },
    orderBy: [
      {
        day: "desc",
      },
    ],
  });

  // 一次性取出所有候选（收入/不计收支），按金额建 Map，避免每笔支出一次数据库查询（N+1）
  const candidates = await prisma.flow.findMany({
    where: {
      flowType: { in: ["收入", "不计收支"] },
      bookId: String(body.bookId),
    },
    orderBy: [{ id: "asc" }],
  });
  const candidateByMoney = new Map<number, (typeof candidates)[number]>();
  for (const c of candidates) {
    const key = Number(c.money);
    if (!candidateByMoney.has(key)) candidateByMoney.set(key, c);
  }

  const candidatePairs = [];
  for (const expense of expenditures) {
    const candidate = candidateByMoney.get(Number(expense.money));
    if (candidate) {
      candidatePairs.push({
        out: expense,
        in: candidate,
      });
    }
  }

  return success(candidatePairs);
});
