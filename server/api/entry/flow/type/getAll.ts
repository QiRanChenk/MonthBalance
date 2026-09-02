import prisma from "~/lib/prisma";

/**
 * @swagger
 * /api/entry/flow/type/getAll:
 *   post:
 *     summary: 获取所有流水类型
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
 *         description: 类型列表获取成功
 *         content:
 *           application/json:
 *             schema:
 *               Result:
 *                 d: [] # { type: 类型分类（"支出类型/收入类型" | "支付方式/收款方式"）, flowType: 流水类型, value: 类型值 }
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

  // groupBy 走 SQL 级去重（Prisma distinct 是拉全量后内存去重）；两个查询并行
  const [industryTypeGroups, payTypeGroups] = await Promise.all([
    prisma.flow.groupBy({
      by: ["industryType", "flowType"],
      orderBy: [
        {
          flowType: "asc",
        },
        {
          industryType: "asc",
        },
      ],
      where, // 使用条件查询
    }),
    prisma.flow.groupBy({
      by: ["payType", "flowType"],
      orderBy: [
        {
          flowType: "asc",
        },
        {
          payType: "asc",
        },
      ],
      where, // 使用条件查询
    }),
  ]);

  // 与原 distinct 语义保持一致：每个 industryType/payType 只保留首个出现的记录
  const seenIndustry = new Set<string>();
  const industryTypes = industryTypeGroups.filter((t) => {
    const key = String(t.industryType ?? "");
    if (seenIndustry.has(key)) return false;
    seenIndustry.add(key);
    return true;
  });
  const seenPay = new Set<string>();
  const payTypes = payTypeGroups.filter((t) => {
    const key = String(t.payType ?? "");
    if (seenPay.has(key)) return false;
    seenPay.add(key);
    return true;
  });

  // console.log(industryTypes);
  // console.log(payTypes);
  const types: any = [];
  industryTypes.forEach((t) => {
    types.push({
      type: "支出类型/收入类型",
      flowType: t.flowType,
      value: t.industryType,
    });
  });
  payTypes.forEach((t) => {
    types.push({
      type: "支付方式/收款方式",
      flowType: t.flowType,
      value: t.payType,
    });
  });

  return success(types);
});
