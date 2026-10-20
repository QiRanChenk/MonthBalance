import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import prisma from "~/lib/prisma";
import { encryptBySHA256 } from "./common";
import {
  authorizeUrl,
  discover,
  linkCheck,
  OidcError,
  pickOrigin,
  randomToken,
  resolveLocalUser,
  safeNext,
  sealPending,
  type FlowMode,
  type Identity,
  type OidcConfig,
  type OidcErrorCode,
  type Pending,
} from "~/lib/oidc";
import { failPath } from "~/lib/oidcFlow";

/**
 * 统一登录（Casdoor OIDC）的服务端帮手：配置、站点地址、JWT、本地账号对应。协议部分在 lib/oidc.ts。
 * 路由在 server/api/oidc/*：
 *   GET  /api/oidc/status            登录页用：{ enabled }
 *   GET  /api/oidc/login?next=/x     跳 Casdoor（state + nonce + PKCE 存在签名的 HttpOnly Cookie 里，10 分钟）
 *   GET  /api/oidc/login?mode=link   （已登录）「绑定统一账号」
 *   GET  /api/oidc/callback          校验后登录（签发和密码登录一样的 JWT）或绑定；浏览器只看到固定代码
 *   GET  /api/oidc/logout            本地退出后（/api/logout 返回 sso: true）跳 Casdoor 退出，再回 /login
 *   GET  /api/oidc/link              （已登录）{ enabled, linked, name }
 *   POST /api/oidc/unlink            （已登录）解除绑定
 * 后台（管理员 NUXT_ADMIN_USERNAME，不在 User 表；绑定存在 AdminOidcLink 表）：
 *   GET  /api/oidc/admin/login            /admin/login 的「用统一账号登录」：只认已绑定的 sub，成功 = 和密码登录一样的 Admin Cookie
 *   GET  /api/oidc/admin/login?mode=link  （已有后台会话）「绑定统一账号」
 *   GET  /api/oidc/admin/logout           后台退出后（/api/admin/logout 返回 sso: true）退出 Casdoor，再回 /admin/login
 *   GET  /api/admin/entry/oidc/status、POST /api/admin/entry/oidc/unlink（后台会话，Admin 请求头）
 * 前后台共用一个回调；模式在签名 Cookie 里，前台流程永远拿不到后台会话，反之亦然（lib/oidcFlow.ts）。
 *
 * 账号对应（lib/oidc.ts resolveLocalUser）：先按已绑定的 sub；否则只有 IdP 说 email_verified 时，按邮箱 / 用户名找
 * 未绑定、非管理员的账号并绑定；用户名等于 NUXT_ADMIN_USERNAME 的账号算管理员，从不按邮箱自动绑定，要先用密码登录
 * 再在右上角菜单点「绑定统一账号」；都没有时只有 NUXT_OIDC_AUTO_CREATE=1 才自动建普通用户。
 */

export const OIDC_PENDING_COOKIE = "cb_oidc";
export const OIDC_PENDING_PATH = "/api/oidc";
export const OIDC_CALLBACK = "/api/oidc/callback";
export const OIDC_DEFAULT_ORIGINS = [
  "https://book.mmkj.site",
  "https://book6.mmkj.site:5002",
  "http://192.168.123.227:9090",
  "http://127.0.0.1:9090",
  "http://localhost:9090",
];
const TOKEN_DAYS = 30;

const trim = (v: unknown) => String(v ?? "").trim().replace(/\/+$/, "");

export function oidcConfig(): OidcConfig | null {
  const rc = useRuntimeConfig();
  const issuer = trim(rc.oidcIssuer);
  const clientId = String(rc.oidcClientId ?? "").trim();
  const clientSecret = String(rc.oidcClientSecret ?? "").trim();
  if (!issuer || !clientId || !clientSecret) return null;
  return { issuer, clientId, clientSecret, internalUrl: trim(rc.oidcInternalUrl) || undefined };
}

export function oidcAllowedOrigins(): string[] {
  const raw = String(useRuntimeConfig().oidcRedirectOrigins ?? "").trim();
  const list = raw ? raw.split(/[\s,]+/) : OIDC_DEFAULT_ORIGINS;
  return [...new Set(list.map(trim).filter(Boolean))];
}

export const oidcAutoCreate = () => String(useRuntimeConfig().oidcAutoCreate ?? "").trim() === "1";

/** 请求在这里看起来的来源；X-Forwarded-* 只有 NUXT_OIDC_TRUST_PROXY=1 时才信。 */
export function oidcRequestOrigin(event: any): string {
  const trusted = String(useRuntimeConfig().oidcTrustProxy ?? "").trim() === "1";
  const proto = getRequestProtocol(event, { xForwardedProto: trusted });
  const host = getRequestHost(event, { xForwardedHost: trusted }) || "localhost";
  return `${proto}://${host}`;
}

export const oidcSiteOrigin = (event: any) => pickOrigin(oidcRequestOrigin(event), oidcAllowedOrigins());

/** 签待完成登录 Cookie 的钥匙：从 NUXT_AUTH_SECRET 派生（重启 / 多实例都一样）。 */
export const oidcPendingKey = () =>
  createHmac("sha256", String(useRuntimeConfig().authSecret ?? "")).update("oidc-pending").digest();

/** 当前登录用户 id（JWT 有效才算）。fromCookie：浏览器直接导航过来（没有 Authorization 头）时读 Cookie。 */
export function oidcTokenUserId(event: any, fromCookie = false): number {
  const token = getHeader(event, "Authorization") || (fromCookie ? getCookie(event, "Authorization") : "") || "";
  if (!token) return 0;
  try {
    const decoded = jwt.verify(token, String(useRuntimeConfig().authSecret)) as any;
    return Number(decoded?.id || 0);
  } catch {
    return 0;
  }
}

/** 是否是统一登录签发的 JWT（退出时顺带退出 Casdoor）。 */
export function oidcTokenVia(event: any): string {
  const token = getHeader(event, "Authorization") || getCookie(event, "Authorization") || "";
  try {
    return String((jwt.verify(token, String(useRuntimeConfig().authSecret)) as any)?.via ?? "");
  } catch {
    return "";
  }
}

/** 和 /api/login 一样签发 JWT 并写 Authorization Cookie（前端从 Cookie 取令牌）。 */
export function oidcIssueToken(event: any, user: { id: number; username: string; email: string | null }) {
  const expiresIn = TOKEN_DAYS * 24 * 60 * 60;
  const token = jwt.sign({ id: user.id, name: user.username, email: user.email, via: "oidc" }, String(useRuntimeConfig().authSecret), {
    expiresIn,
  });
  setCookie(event, "Authorization", token, { maxAge: expiresIn, path: "/", sameSite: "lax" });
  return token;
}

/** 详情写日志，浏览器只拿到固定代码。 */
export function oidcFail(event: any, code: OidcErrorCode, detail: string, mode: FlowMode = "login") {
  console.warn(`[oidc] ${mode} failed (${code}): ${detail}`);
  return sendRedirect(event, failPath(mode, code), 302);
}

const PENDING_MS = 10 * 60_000;

/** 发起：写签名的待完成 Cookie（state / nonce / PKCE / 模式），跳 Casdoor。 */
export async function oidcStart(event: any, mode: FlowMode, next: string, uid?: string) {
  const cfg = oidcConfig();
  if (!cfg) return oidcFail(event, "not_configured", "OIDC is not configured", mode);
  const origin = oidcSiteOrigin(event);
  if (!origin) return oidcFail(event, "failed", `request origin ${oidcRequestOrigin(event)} is not among the allowed site addresses`, mode);
  try {
    const doc = await discover(cfg);
    const pending: Pending = {
      ...oidcNewPendingTokens(),
      redirectUri: origin + OIDC_CALLBACK,
      next: safeNext(next),
      exp: Date.now() + PENDING_MS,
      mode,
      ...(uid ? { uid } : {}),
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
}

// ---------- 后台管理员 ----------

export const ADMIN_VIA_COOKIE = "AdminVia";
const ADMIN_DAYS = 7;

/** 和 /api/admin/login 一样的后台令牌；没配置管理员时为空。 */
export function oidcAdminToken(): string {
  const rc = useRuntimeConfig();
  const u = String(rc.adminUsername ?? "");
  const p = String(rc.adminPassword ?? "");
  return u && p ? encryptBySHA256(u, p) : "";
}

/** 当前请求是否带着有效的后台会话（Admin 请求头，或浏览器直接导航时的 Admin Cookie）。 */
export function oidcAdminSession(event: any, fromCookie = false): boolean {
  const want = oidcAdminToken();
  const got = String(getHeader(event, "Admin") || (fromCookie ? getCookie(event, "Admin") : "") || "");
  return Boolean(want) && got.length === want.length && sameStringSafe(got, want);
}

function sameStringSafe(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

/** 后台会话：和密码登录完全一样的 Admin Cookie；另记一个 HttpOnly 的 AdminVia，退出时据此顺带退出 Casdoor。 */
export function oidcIssueAdminSession(event: any) {
  const maxAge = ADMIN_DAYS * 24 * 60 * 60;
  setCookie(event, "Admin", oidcAdminToken(), { maxAge, path: "/" });
  setCookie(event, ADMIN_VIA_COOKIE, "oidc", { maxAge, path: "/api/admin", httpOnly: true, sameSite: "lax" });
}

export const oidcAdminLinkRow = () => prisma.adminOidcLink.findUnique({ where: { id: 1 } });

export async function oidcSetAdminLink(i: Identity) {
  await prisma.adminOidcLink.upsert({
    where: { id: 1 },
    create: { id: 1, sub: i.sub, name: oidcIdName(i) },
    update: { sub: i.sub, name: oidcIdName(i) },
  });
}

export const oidcClearAdminLink = () => prisma.adminOidcLink.deleteMany({ where: { id: 1 } });

// ---------- 本地账号 ----------

type Row = {
  id: number;
  username: string;
  email: string | null;
  disabled: 0;
  oidc_sub: string | null;
  oidc_name: string | null;
};
const toRow = (u: any): Row | undefined =>
  u ? { id: Number(u.id), username: u.username, email: u.email ?? null, disabled: 0, oidc_sub: u.oidcSub ?? null, oidc_name: u.oidcName ?? null } : undefined;

export const oidcIdName = (i: Identity) =>
  i.username && i.email && i.username !== i.email ? `${i.username}（${i.email}）` : i.email || i.username || i.sub;

const bySub = async (sub: string) => toRow(await prisma.user.findUnique({ where: { oidcSub: sub } }));

async function byEmail(email: string) {
  const e = email.toLowerCase();
  const hit =
    (await prisma.$queryRaw<{ id: number }[]>`SELECT "id" FROM "User" WHERE lower("email") = ${e} ORDER BY "id" LIMIT 1`)[0] ??
    (await prisma.$queryRaw<{ id: number }[]>`SELECT "id" FROM "User" WHERE lower("username") = ${e} ORDER BY "id" LIMIT 1`)[0];
  return hit ? toRow(await prisma.user.findUnique({ where: { id: Number(hit.id) } })) : undefined;
}

/** 只在账号还没绑定时写，返回是否写了。邮箱只在 IdP 说已验证时才记。 */
async function setLink(userId: number, i: Identity) {
  try {
    const r = await prisma.user.updateMany({
      where: { id: userId, oidcSub: null },
      data: { oidcSub: i.sub, oidcName: oidcIdName(i), ...(i.emailVerified && i.email ? { email: i.email } : {}) },
    });
    return r.count === 1;
  } catch {
    return false; // 唯一约束：这个 sub 刚被别的账号绑走
  }
}

const isAdmin = (u: Row) => {
  const admin = String(useRuntimeConfig().adminUsername ?? "").trim();
  return Boolean(admin) && u.username.toLowerCase() === admin.toLowerCase();
};

export function oidcMapUser(ident: Identity) {
  return resolveLocalUser<Row>(ident, {
    autoCreate: oidcAutoCreate(),
    bySub,
    byEmail,
    isAdmin,
    // 没有对应账号：建普通用户，用户名 = 邮箱，密码随机（谁都不知道；需要时管理员在后台重设）
    create: async (i) => {
      if (isAdmin({ id: 0, username: i.email, email: null, disabled: 0, oidc_sub: null, oidc_name: null }))
        throw new OidcError("admin_link", `refusing to create an account named like the admin (${i.email})`);
      const u = await prisma.user.create({
        data: { username: i.email, password: encryptBySHA256(i.email, randomToken(24)), name: i.name || i.username || i.email },
      });
      return toRow(u)!;
    },
    link: (u, i) => setLink(u.id, i),
  });
}

/** 「绑定统一账号」：当前登录的账号接收这个统一账号。 */
export async function oidcLinkUser(uid: number, ident: Identity) {
  const me = toRow(await prisma.user.findUnique({ where: { id: uid } }));
  if (!me) throw new OidcError("expired", `account ${uid} is gone`);
  await linkCheck(me, ident, bySub);
  if (me.oidc_sub === ident.sub) return me;
  if (!(await setLink(me.id, ident))) throw new OidcError("conflict", `account ${me.id} got linked concurrently`);
  return me;
}

export const oidcNewPendingTokens = () => ({ state: randomToken(), nonce: randomToken(), verifier: randomToken(48) });
