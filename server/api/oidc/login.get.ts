import { authorizeUrl, discover, safeNext, sealPending, type Pending } from "~/lib/oidc";

const PENDING_MS = 10 * 60_000;

/** 跳 Casdoor 登录；?mode=link 时为当前登录的账号「绑定统一账号」。 */
export default defineEventHandler(async (event) => {
  const q = getQuery(event);
  const mode = q.mode === "link" ? "link" : "login";
  const cfg = oidcConfig();
  if (!cfg) return oidcFail(event, "not_configured", "OIDC is not configured", mode);
  const uid = mode === "link" ? oidcTokenUserId(event, true) : 0;
  if (mode === "link" && !uid) return oidcFail(event, "expired", "link requested without a session", mode);
  const origin = oidcSiteOrigin(event);
  if (!origin) return oidcFail(event, "failed", `request origin ${oidcRequestOrigin(event)} is not among the allowed site addresses`, mode);
  try {
    const doc = await discover(cfg);
    const pending: Pending = {
      ...oidcNewPendingTokens(),
      redirectUri: origin + OIDC_CALLBACK,
      next: mode === "link" ? "/calendar" : safeNext(q.next),
      exp: Date.now() + PENDING_MS,
      mode,
      ...(uid ? { uid: String(uid) } : {}),
    };
    setCookie(event, OIDC_PENDING_COOKIE, sealPending(pending, oidcPendingKey()), {
      httpOnly: true,
      sameSite: "lax", // Casdoor 用顶层 GET 把浏览器送回来，Lax 会带上
      secure: origin.startsWith("https:"),
      path: OIDC_PENDING_PATH,
      maxAge: PENDING_MS / 1000,
    });
    return sendRedirect(event, authorizeUrl(doc, cfg, pending), 302);
  } catch (e) {
    return oidcFail(event, "failed", `discovery: ${(e as Error).message}`, mode);
  }
});
