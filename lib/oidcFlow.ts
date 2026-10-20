import { OidcError, sameString, type FlowMode, type Identity, type OidcErrorCode } from "./oidc";

/**
 * 统一登录回调的分流规则（纯函数，方便单测）。
 *
 * 前台（User 表里的普通用户，JWT 存在 Authorization Cookie）和后台（NUXT_ADMIN_USERNAME，Admin Cookie）是两套账号。
 * 发起登录时把模式写进签名的待完成 Cookie，回调只按这个模式走：
 *   login        → 只可能得到前台会话（Authorization），绝不签发 Admin
 *   link         → 前台账号绑定
 *   admin-login  → 只认后台绑定的 sub（不按邮箱、不自动建），只可能得到后台会话（Admin），绝不签发 Authorization
 *   admin-link   → 已登录的后台会话绑定当前 Casdoor 账号
 */

export const FLOW_MODES: FlowMode[] = ["login", "link", "admin-login", "admin-link"];
export const isAdminMode = (m: FlowMode) => m === "admin-login" || m === "admin-link";
export const isLinkMode = (m: FlowMode) => m === "link" || m === "admin-link";

/** 签名 Cookie 里的模式；缺失 / 不认识的按前台登录处理（最小权限）。 */
export function flowMode(m: unknown): FlowMode {
  return FLOW_MODES.includes(m as FlowMode) ? (m as FlowMode) : "login";
}

/** 失败时跳去哪儿（浏览器只看到固定代码）。 */
export function failPath(mode: FlowMode, code: OidcErrorCode): string {
  switch (mode) {
    case "admin-login":
      return `/admin/login?oidc_error=${code}`;
    case "admin-link":
      return `/admin?oidc_link=${code}`;
    case "link":
      return `/calendar?oidc_link=${code}`;
    default:
      return `/login?oidc_error=${code}`;
  }
}

/** 后台登录：只有和已绑定的 sub 完全一致才放行。没绑定 / 不一致 → not_allowed。 */
export function checkAdminLogin(ident: Identity, boundSub: string | null | undefined): void {
  if (!boundSub) throw new OidcError("not_allowed", `admin console has no linked identity; ${ident.sub} refused`);
  if (!sameString(ident.sub, boundSub)) throw new OidcError("not_allowed", `identity ${ident.sub} is not the admin's linked identity`);
}

/** 后台绑定：已经绑了别的 sub 时拒绝（先解除）；同一个 sub 重复绑定没关系。 */
export function checkAdminLink(ident: Identity, boundSub: string | null | undefined): void {
  if (boundSub && boundSub !== ident.sub) throw new OidcError("conflict", `admin console is linked to ${boundSub}, not ${ident.sub}`);
}
