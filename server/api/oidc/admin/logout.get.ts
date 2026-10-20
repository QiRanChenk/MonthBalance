import { discover, endSessionUrl } from "~/lib/oidc";

/** 后台退出后（/api/admin/logout 返回 sso: true）：退出 Casdoor，再回本站 /admin/login。 */
export default defineEventHandler(async (event) => {
  const cfg = oidcConfig();
  const origin = oidcSiteOrigin(event);
  if (!cfg || !origin) return sendRedirect(event, "/admin/login", 302);
  try {
    return sendRedirect(event, endSessionUrl(await discover(cfg), cfg, `${origin}/admin/login`) ?? "/admin/login", 302);
  } catch {
    return sendRedirect(event, "/admin/login", 302);
  }
});
