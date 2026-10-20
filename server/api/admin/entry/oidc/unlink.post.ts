/** （后台会话，Admin 请求头）解除后台的统一账号绑定。 */
export default defineEventHandler(async () => {
  await oidcClearAdminLink();
  console.log("[oidc] 后台管理员解除了统一账号绑定");
  return success({ ok: true });
});
