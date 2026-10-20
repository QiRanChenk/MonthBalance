/**
 * @swagger
 * /api/admin/logout:
 *   post:
 *     summary: 管理员退出登录
 *     tags: ["Admin"]
 *     security:
 *       - Admin: []
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

  // 统一登录进来的后台会话：前端随后跳 /api/oidc/admin/logout 退出 Casdoor（单点退出）
  const sso = getCookie(event, ADMIN_VIA_COOKIE) === "oidc" && Boolean(oidcConfig());
  deleteCookie(event, "Admin");
  deleteCookie(event, ADMIN_VIA_COOKIE, { path: "/api/admin" });

  return success(sso ? { sso: true } : "退出成功");
});
