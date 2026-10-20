/** 前台：跳 Casdoor 登录；?mode=link 时为当前登录的账号「绑定统一账号」。只会得到前台会话。 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const mode = q.mode === "link" ? "link" : "login";
  if (mode === "link") {
    const uid = oidcTokenUserId(event, true);
    if (!uid) return oidcFail(event, "expired", "link requested without a session", mode);
    return oidcStart(event, mode, "/calendar", String(uid));
  }
  return oidcStart(event, mode, String(q.next ?? "/"));
});
