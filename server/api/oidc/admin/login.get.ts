/**
 * 后台：/admin/login 的「用统一账号登录」（只认已绑定的 sub）；?mode=link 时为已登录的后台「绑定统一账号」。
 * 只会得到后台会话（Admin Cookie），和前台流程的模式不同、不能互换。
 */
export default defineEventHandler(async (event) => {
  const mode = getQuery(event).mode === "link" ? "admin-link" : "admin-login";
  if (!oidcAdminToken()) return oidcFail(event, "not_configured", "admin account is not configured", mode);
  if (mode === "admin-link" && !oidcAdminSession(event, true))
    return oidcFail(event, "expired", "admin link requested without an admin session", mode);
  return oidcStart(event, mode, "/admin/");
});
