import { discover, endSessionUrl } from "~/lib/oidc";

/** 本地退出后（/api/logout 返回 sso: true）：退出 Casdoor，再回本站 /login。 */
export default defineEventHandler(async (event) => {
  const cfg = oidcConfig();
  const origin = oidcSiteOrigin(event);
  if (!cfg || !origin) return sendRedirect(event, "/login", 302);
  try {
    return sendRedirect(event, endSessionUrl(await discover(cfg), cfg, `${origin}/login`) ?? "/login", 302);
  } catch {
    return sendRedirect(event, "/login", 302);
  }
});
