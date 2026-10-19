import { completeLogin, OidcError, openPending, sameString } from "~/lib/oidc";

/** Casdoor 回调：校验 state、换令牌、验 ID token，然后登录或绑定。浏览器只看到固定代码，详情写日志。 */
export default defineEventHandler(async (event) => {
  const cfg = oidcConfig();
  const pending = openPending(getCookie(event, OIDC_PENDING_COOKIE), oidcPendingKey());
  deleteCookie(event, OIDC_PENDING_COOKIE, { path: OIDC_PENDING_PATH });
  const mode = pending?.mode === "link" ? "link" : "login";
  const q = getQuery(event);
  if (!cfg) return oidcFail(event, "not_configured", "OIDC is not configured", mode);
  if (typeof q.error === "string") return oidcFail(event, "failed", `IdP error: ${String(q.error_description || q.error)}`, mode);
  const state = typeof q.state === "string" ? q.state : "";
  const code = typeof q.code === "string" ? q.code : "";
  if (!pending) return oidcFail(event, "expired", "pending cookie missing, forged or expired", mode);
  if (!state || !sameString(state, pending.state)) return oidcFail(event, "expired", "state mismatch", mode);
  if (!code) return oidcFail(event, "failed", "no authorization code", mode);
  try {
    const ident = await completeLogin(cfg, { code, redirectUri: pending.redirectUri, verifier: pending.verifier, nonce: pending.nonce });
    if (mode === "link") {
      // 还是发起绑定的那个账号吗？
      const uid = oidcTokenUserId(event, true);
      if (!uid || String(uid) !== pending.uid) return oidcFail(event, "expired", "session changed during linking", mode);
      await oidcLinkUser(uid, ident);
      console.log(`[oidc] 账号 ${uid} 绑定了统一账号 ${ident.sub}（${oidcIdName(ident)}）`);
      return sendRedirect(event, "/calendar?oidc_link=ok", 302);
    }
    const { user, created } = await oidcMapUser(ident);
    if (created) console.log(`[oidc] 自动创建账号「${user.username}」`);
    oidcIssueToken(event, user);
    return sendRedirect(event, pending.next, 302);
  } catch (e) {
    return oidcFail(event, e instanceof OidcError ? e.code : "failed", (e as Error).message, mode);
  }
});
