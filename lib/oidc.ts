import { createHash, createHmac, createPublicKey, randomBytes, timingSafeEqual, verify, type JsonWebKey } from 'node:crypto';

/**
 * 统一登录 (Casdoor, OpenID Connect) — the protocol half, with no database access so it can be tested on its own.
 * Ported from 邮件签名智能生成器/server/oidc.ts (security-reviewed); keep the two in step.
 * Authorization code flow + PKCE (S256) + state + nonce; the code is exchanged server-to-server with the client
 * secret, the ID token is checked against the issuer's JWKS (signature, iss, aud, exp, nonce), then userinfo is read.
 *
 * `internalUrl` (optional, default empty) is where this server sends the token and userinfo calls (e.g.
 * http://192.168.123.227:8001 on the LAN). Discovery and the JWKS — the things that decide which keys are trusted —
 * always come from the public https issuer, never from the internal address. The browser always goes to the public
 * endpoints, and the issuer in the ID token must equal the public issuer.
 */

export type OidcConfig = { issuer: string; clientId: string; clientSecret: string; internalUrl?: string };
export type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint?: string;
  jwks_uri?: string;
  end_session_endpoint?: string;
};
/** emailVerified is true only when the IdP says `email_verified: true`. */
export type Identity = { sub: string; email: string; emailVerified: boolean; name: string; username: string };

/** `code` is what the browser gets to see (a fixed set); `message` (details) only goes to the server log. */
export type OidcErrorCode = 'failed' | 'expired' | 'no_account' | 'unverified' | 'admin_link' | 'disabled' | 'conflict' | 'not_configured' | 'not_allowed';
export class OidcError extends Error {
  constructor(
    readonly code: OidcErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

const trimSlash = (s: string) => s.replace(/\/+$/, '');

/** Where this server sends the token / userinfo calls: the public URL, or the same path on `internalUrl`. */
export function serverSide(endpoint: string, cfg: OidcConfig): string {
  const internal = trimSlash(cfg.internalUrl ?? '');
  if (!internal) return endpoint;
  const pub = new URL(trimSlash(cfg.issuer));
  const ep = new URL(endpoint);
  if (ep.origin !== pub.origin) return endpoint;
  return internal + ep.pathname + ep.search;
}

const discoveryCache = new Map<string, { at: number; doc: Discovery }>();
const jwksCache = new Map<string, { at: number; keys: JsonWebKey[] }>();
const CACHE_MS = 60 * 60_000;

export function clearOidcCaches() {
  discoveryCache.clear();
  jwksCache.clear();
}

async function getJson(fetchFn: FetchFn, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetchFn(url, { ...init, signal: AbortSignal.timeout(10_000) });
  const text = await res.text();
  let body: Record<string, unknown>;
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    throw new Error(`统一登录服务返回了非 JSON 内容（HTTP ${res.status}）`);
  }
  if (!res.ok) {
    const msg = String(body.error_description || body.error || body.msg || `HTTP ${res.status}`);
    throw new Error(`统一登录服务出错：${msg}`);
  }
  return body;
}

export async function discover(cfg: OidcConfig, fetchFn: FetchFn = fetch): Promise<Discovery> {
  const issuer = trimSlash(cfg.issuer);
  const hit = discoveryCache.get(issuer);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.doc;
  // Always from the public issuer (https in production), never from the internal address.
  const doc = (await getJson(fetchFn, `${issuer}/.well-known/openid-configuration`)) as unknown as Discovery;
  if (trimSlash(String(doc.issuer ?? '')) !== issuer) throw new Error(`发现文档的 issuer（${doc.issuer}）与配置的（${issuer}）不一致`);
  if (!doc.authorization_endpoint || !doc.token_endpoint) throw new Error('发现文档缺少 authorization_endpoint / token_endpoint');
  discoveryCache.set(issuer, { at: Date.now(), doc });
  return doc;
}

// ---------- PKCE / random values ----------

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

// ---------- the pending-login cookie (state, nonce, PKCE verifier), HMAC-signed ----------

/** mode 'link': 「绑定统一账号」 for the signed-in account `uid` instead of signing in. */
export type Pending = { state: string; nonce: string; verifier: string; redirectUri: string; next: string; exp: number; mode?: FlowMode; uid?: string };
/** 前台（用户）与后台（管理员）各有登录 / 绑定两种；模式在签名 Cookie 里，回调只按它分流。 */
export type FlowMode = 'login' | 'link' | 'admin-login' | 'admin-link';

export function sealPending(p: Pending, key: Buffer): string {
  const body = Buffer.from(JSON.stringify(p)).toString('base64url');
  const mac = createHmac('sha256', key).update(body).digest('base64url');
  return `${body}.${mac}`;
}

/** Returns null when the cookie is missing, tampered with or expired. */
export function openPending(value: string | undefined, key: Buffer, now = Date.now()): Pending | null {
  if (!value) return null;
  const [body, mac] = value.split('.');
  if (!body || !mac) return null;
  const want = Buffer.from(createHmac('sha256', key).update(body).digest('base64url'));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as Pending;
    if (typeof p.exp !== 'number' || p.exp < now) return null;
    return p;
  } catch {
    return null;
  }
}

export function sameString(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

// ---------- redirect URI / next ----------

/**
 * The redirect URI must be one the IdP knows, so it is chosen from the allowed site addresses rather than built
 * blindly from request headers. `requestOrigin` is what the request looks like from here (scheme from
 * X-Forwarded-Proto only when TRUST_PROXY is set). An exact match wins; otherwise a unique allowed address with the
 * same host name is used (a reverse proxy that sends `Host: $host` drops the port, and without TRUST_PROXY the
 * scheme looks like http). Returns null when nothing fits.
 */
export function pickOrigin(requestOrigin: string, allowed: string[]): string | null {
  let req: URL;
  try {
    req = new URL(requestOrigin);
  } catch {
    return null;
  }
  const list = allowed
    .map((a) => {
      try {
        return new URL(a.trim());
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => Boolean(u));
  const exact = list.find((u) => u.origin === req.origin);
  if (exact) return exact.origin;
  let same = list.filter((u) => u.hostname === req.hostname);
  if (req.port) same = same.filter((u) => u.port === req.port);
  const origins = [...new Set(same.map((u) => u.origin))];
  return origins.length === 1 ? origins[0] : null;
}

/** Only same-site relative paths survive as the post-login destination. */
export function safeNext(next: unknown): string {
  const s = typeof next === 'string' ? next : '';
  if (!s.startsWith('/') || s.startsWith('//') || s.startsWith('/\\') || /[\r\n]/.test(s)) return '/';
  return s.slice(0, 500);
}

export function authorizeUrl(doc: Discovery, cfg: OidcConfig, p: Pending): string {
  const u = new URL(doc.authorization_endpoint);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('state', p.state);
  u.searchParams.set('nonce', p.nonce);
  u.searchParams.set('code_challenge', pkceChallenge(p.verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return u.toString();
}

export function endSessionUrl(doc: Discovery, cfg: OidcConfig, postLogoutRedirectUri: string): string | null {
  if (!doc.end_session_endpoint) return null;
  const u = new URL(doc.end_session_endpoint);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('post_logout_redirect_uri', postLogoutRedirectUri);
  return u.toString();
}

// ---------- ID token ----------

type Claims = Record<string, unknown>;

function b64json(part: string): Claims {
  return JSON.parse(Buffer.from(part, 'base64url').toString()) as Claims;
}

const ALGS: Record<string, { hash: string; pss?: boolean; ec?: boolean }> = {
  RS256: { hash: 'sha256' },
  RS384: { hash: 'sha384' },
  RS512: { hash: 'sha512' },
  PS256: { hash: 'sha256', pss: true },
  PS384: { hash: 'sha384', pss: true },
  PS512: { hash: 'sha512', pss: true },
  ES256: { hash: 'sha256', ec: true },
  ES384: { hash: 'sha384', ec: true },
  ES512: { hash: 'sha512', ec: true },
};

export function verifyIdToken(
  idToken: string,
  opts: { issuer: string; clientId: string; nonce: string; keys: JsonWebKey[]; now?: number; skewSec?: number },
): Claims {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('ID token 格式不对');
  const header = b64json(parts[0]);
  const claims = b64json(parts[1]);
  const alg = ALGS[String(header.alg)];
  if (!alg) throw new Error(`不支持的 ID token 签名算法：${String(header.alg)}`);
  const kid = header.kid ? String(header.kid) : '';
  const candidates = opts.keys.filter((k) => (!kid || (k as { kid?: string }).kid === kid) && (!k.use || k.use === 'sig'));
  if (!candidates.length) throw new Error('找不到签名 ID token 的公钥（kid 不匹配）');
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2], 'base64url');
  const ok = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      if (alg.ec) return verify(alg.hash, data, { key, dsaEncoding: 'ieee-p1363' }, sig);
      if (alg.pss) return verify(alg.hash, data, { key, padding: 6 /* RSA_PKCS1_PSS_PADDING */, saltLength: { sha256: 32, sha384: 48, sha512: 64 }[alg.hash] }, sig);
      return verify(alg.hash, data, key, sig);
    } catch {
      return false;
    }
  });
  if (!ok) throw new Error('ID token 签名无效');
  const now = Math.floor((opts.now ?? Date.now()) / 1000);
  const skew = opts.skewSec ?? 120;
  if (trimSlash(String(claims.iss ?? '')) !== trimSlash(opts.issuer)) throw new Error('ID token 的 iss 不对');
  const aud = Array.isArray(claims.aud) ? claims.aud.map(String) : [String(claims.aud ?? '')];
  if (!aud.includes(opts.clientId)) throw new Error('ID token 的 aud 不是本系统');
  if (aud.length > 1 && claims.azp !== undefined && claims.azp !== opts.clientId) throw new Error('ID token 的 azp 不是本系统');
  if (typeof claims.exp !== 'number' || claims.exp + skew < now) throw new Error('ID token 已过期');
  if (typeof claims.nbf === 'number' && claims.nbf - skew > now) throw new Error('ID token 尚未生效');
  if (typeof claims.nonce !== 'string' || !sameString(claims.nonce, opts.nonce)) throw new Error('ID token 的 nonce 不匹配');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new Error('ID token 缺少 sub');
  return claims;
}

async function jwks(doc: Discovery, fetchFn: FetchFn, refresh = false): Promise<JsonWebKey[]> {
  if (!doc.jwks_uri) throw new Error('发现文档缺少 jwks_uri');
  const url = doc.jwks_uri; // public, like discovery — keys are never taken from the internal address
  const hit = jwksCache.get(url);
  if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.keys;
  const body = await getJson(fetchFn, url);
  const keys = Array.isArray(body.keys) ? (body.keys as JsonWebKey[]) : [];
  jwksCache.set(url, { at: Date.now(), keys });
  return keys;
}

// ---------- the callback ----------

/** Exchanges the code, checks the ID token, reads userinfo. Throws with a readable (Chinese) message. */
export async function completeLogin(
  cfg: OidcConfig,
  input: { code: string; redirectUri: string; verifier: string; nonce: string },
  fetchFn: FetchFn = fetch,
  now = Date.now(),
): Promise<Identity> {
  const doc = await discover(cfg, fetchFn);
  const form = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code_verifier: input.verifier,
  });
  const tok = await getJson(fetchFn, serverSide(doc.token_endpoint, cfg), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (tok.error) throw new Error(`换取令牌失败：${String(tok.error_description || tok.error)}`);
  const idToken = String(tok.id_token ?? '');
  const accessToken = String(tok.access_token ?? '');
  if (!idToken || !accessToken) throw new Error('统一登录没有返回 ID token / access token');
  const verifyOpts = { issuer: cfg.issuer, clientId: cfg.clientId, nonce: input.nonce, now };
  let claims: Claims;
  try {
    claims = verifyIdToken(idToken, { ...verifyOpts, keys: await jwks(doc, fetchFn) });
  } catch (e) {
    // Keys may have been rotated since they were cached: retry once with a fresh set.
    if (!/公钥|签名无效/.test((e as Error).message)) throw e;
    claims = verifyIdToken(idToken, { ...verifyOpts, keys: await jwks(doc, fetchFn, true) });
  }
  let info: Claims = {};
  if (doc.userinfo_endpoint) {
    info = await getJson(fetchFn, serverSide(doc.userinfo_endpoint, cfg), { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    if (info.sub !== undefined && String(info.sub) !== String(claims.sub)) throw new Error('userinfo 与 ID token 不是同一个用户');
  }
  const pick = (k: string) => String(info[k] ?? claims[k] ?? '').trim();
  return {
    sub: String(claims.sub),
    email: pick('email').toLowerCase(),
    emailVerified: (info.email_verified ?? claims.email_verified) === true,
    name: pick('name') || pick('preferred_username'),
    username: pick('preferred_username') || pick('name'),
  };
}

// ---------- mapping to a local account ----------

export type LocalUser = { id: string | number; disabled: number | boolean; oidc_sub?: string | null };
type MaybePromise<T> = T | Promise<T>;
export type MapDeps<U extends LocalUser> = {
  bySub: (sub: string) => MaybePromise<U | undefined>;
  /** Any account whose email (or username, accounts are often named by their email) matches. */
  byEmail: (email: string) => MaybePromise<U | undefined>;
  isAdmin: (user: U) => boolean;
  /** Must create a non-admin account. */
  create: (id: Identity) => MaybePromise<U>;
  /** Must only set the subject when the account has none yet (returns false otherwise). */
  link: (user: U, id: Identity) => MaybePromise<boolean>;
  autoCreate: boolean;
};

/**
 * Sign-in: the local account for an IdP identity (async here because Prisma is).
 *  1. the account already linked to this `sub` (admins get here only after linking themselves, see linkCheck);
 *  2. else, only with a verified email: an account with that email that is not linked yet and is not an admin;
 *     an account already linked to another `sub` is refused, an admin account must be linked by hand;
 *  3. else a new non-admin account when auto-create is on.
 */
export async function resolveLocalUser<U extends LocalUser>(id: Identity, deps: MapDeps<U>): Promise<{ user: U; created: boolean }> {
  const linked = await deps.bySub(id.sub);
  if (linked) {
    if (linked.disabled) throw new OidcError('disabled', `account ${linked.id} is disabled`);
    return { user: linked, created: false };
  }
  if (!id.email) throw new OidcError('no_account', `identity ${id.sub} has no email`);
  if (!id.emailVerified) throw new OidcError('unverified', `email ${id.email} of ${id.sub} is not verified`);
  const match = await deps.byEmail(id.email);
  if (match) {
    if (match.oidc_sub) throw new OidcError('conflict', `account ${match.id} (${id.email}) is linked to another subject, not ${id.sub}`);
    if (deps.isAdmin(match)) throw new OidcError('admin_link', `admin account ${match.id} (${id.email}) must be linked by hand`);
    if (match.disabled) throw new OidcError('disabled', `account ${match.id} is disabled`);
    if (!(await deps.link(match, id))) throw new OidcError('conflict', `account ${match.id} got linked concurrently`);
    return { user: match, created: false };
  }
  if (!deps.autoCreate) throw new OidcError('no_account', `no local account for ${id.email} and auto-create is off`);
  const user = await deps.create(id);
  if (!(await deps.link(user, id))) throw new OidcError('conflict', `new account ${user.id} could not be linked`);
  return { user, created: true };
}

/**
 * Link mode (「绑定统一账号」): the signed-in account `me` takes this IdP identity. Refused when the identity already
 * belongs to another account or `me` is linked to a different identity (unlink first).
 */
export async function linkCheck<U extends LocalUser>(me: U, id: Identity, bySub: (sub: string) => MaybePromise<U | undefined>): Promise<void> {
  const other = await bySub(id.sub);
  if (other && String(other.id) !== String(me.id)) throw new OidcError('conflict', `subject ${id.sub} is already linked to account ${other.id}`);
  if (me.oidc_sub && me.oidc_sub !== id.sub) throw new OidcError('conflict', `account ${me.id} is linked to ${me.oidc_sub}, not ${id.sub}`);
}
