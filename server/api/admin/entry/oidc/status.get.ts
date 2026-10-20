/** （后台会话，由 server/middleware/auth.ts 校验 Admin 请求头）后台的统一账号绑定状态。 */
export default defineEventHandler(async () => {
  const row = await oidcAdminLinkRow();
  return success({ enabled: Boolean(oidcConfig()), linked: Boolean(row), name: row ? row.name || row.sub : null });
});
