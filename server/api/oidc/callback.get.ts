import { completeLogin, OidcError, openPending, sameString } from "~/lib/oidc";
import { checkAdminLink, checkAdminLogin, flowMode } from "~/lib/oidcFlow";

/**
 * Casdoor 回调（前后台共用）：校验 state、换令牌、验 ID token，再按签名 Cookie 里的模式分流：
 * login / link 只碰前台账号和 Authorization；admin-login / admin-link 只碰后台绑定和 Admin。
 * 浏览器只看到固定代码，详情写日志。
 */
export default defineEventHandler(async (event) => {
  const cfg = oidcConfig();
  const pending = openPending(getCookie(event, OIDC_PENDING_COOKIE), oidcPendingKey());
  deleteCookie(event, OIDC_PENDING_COOKIE, { path: OIDC_PENDING_PATH });
  const mode = flowMode(pending?.mode);
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
    switch (mode) {
      case "admin-login": {
        checkAdminLogin(ident, (await oidcAdminLinkRow())?.sub);
        if (!oidcAdminToken()) throw new OidcError("not_configured", "admin account is not configured");
        oidcIssueAdminSession(event);
        console.log(`[oidc] 后台管理员用统一账号 ${ident.sub}（${oidcIdName(ident)}）登录`);
        return sendRedirect(event, "/admin/", 302);
      }
      case "admin-link": {
        if (!oidcAdminSession(event, true)) return oidcFail(event, "expired", "admin session gone during linking", mode);
        checkAdminLink(ident, (await oidcAdminLinkRow())?.sub);
        await oidcSetAdminLink(ident);
        console.log(`[oidc] 后台管理员绑定了统一账号 ${ident.sub}（${oidcIdName(ident)}）`);
        return sendRedirect(event, "/admin?oidc_link=ok", 302);
      }
      case "link": {
        // 还是发起绑定的那个账号吗？
        const uid = oidcTokenUserId(event, true);
        if (!uid || String(uid) !== pending.uid) return oidcFail(event, "expired", "session changed during linking", mode);
        await oidcLinkUser(uid, ident);
        console.log(`[oidc] 账号 ${uid} 绑定了统一账号 ${ident.sub}（${oidcIdName(ident)}）`);
        return sendRedirect(event, "/calendar?oidc_link=ok", 302);
      }
      default: {
        const { user, created } = await oidcMapUser(ident);
        if (created) console.log(`[oidc] 自动创建账号「${user.username}」`);
        oidcIssueToken(event, user);
        return sendRedirect(event, pending.next, 302);
      }
    }
  } catch (e) {
    return oidcFail(event, e instanceof OidcError ? e.code : "failed", (e as Error).message, mode);
  }
});
