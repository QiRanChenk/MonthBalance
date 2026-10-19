/**
 * @swagger
 * /api/logout:
 *   post:
 *     summary: 用户退出登录
 *     tags: ["Base"]
 *     security:
 *       - Authorization: []
 *     responses:
 *       200:
 *         description: 退出成功
 *         content:
 *           application/json:
 *             schema:
 *               Result: {
 *                 d: "退出成功"
 *               }
 */
export default defineEventHandler(async (event) => {
  // const Authorization = getHeader(event, "Admin");
  // 统一登录签发的令牌：前端随后跳 /api/oidc/logout 退出 Casdoor（单点退出）
  const sso = oidcTokenVia(event) === "oidc" && Boolean(oidcConfig());

  deleteCookie(event, "Authorization");

  return success(sso ? { sso: true } : "退出成功");
});
