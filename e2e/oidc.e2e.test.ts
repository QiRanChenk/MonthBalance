/**
 * 统一登录端到端：起一个假的 Casdoor（本进程内）+ 已构建的服务（.output），走真实路由。
 * 运行：npx nuxt build && npm run test:e2e（需要 CASHBOOK_E2E=1；普通 npm test 跳过）。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtempSync, existsSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const RUN = process.env.CASHBOOK_E2E === "1";
const APP_PORT = 19391;
const IDP_PORT = 19555;
const B = `http://localhost:${APP_PORT}`;
const ISS = `http://127.0.0.1:${IDP_PORT}`;
const ADMIN_USER = "e2eadmin";
const ADMIN_PW = "e2e-admin-pass";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

// ---------- fake Casdoor ----------
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: "jwk" }) as object), kid: "k1", use: "sig", alg: "RS256" };
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
type Who = { sub: string; email: string; email_verified: boolean; preferred_username: string };
let who: Who = { sub: "uuid-1", email: "user1@example.com", email_verified: true, preferred_username: "u1" };
const grants = new Map<string, { ch: string; ru: string; nonce: string; who: Who }>();
const idp = http.createServer(async (req, res) => {
  const u = new URL(req.url!, ISS);
  const json = (o: unknown, s = 200) => {
    res.writeHead(s, { "content-type": "application/json" });
    res.end(JSON.stringify(o));
  };
  if (u.pathname === "/.well-known/openid-configuration")
    return json({ issuer: ISS, authorization_endpoint: `${ISS}/authorize`, token_endpoint: `${ISS}/token`, userinfo_endpoint: `${ISS}/userinfo`, jwks_uri: `${ISS}/jwks`, end_session_endpoint: `${ISS}/logout` });
  if (u.pathname === "/jwks") return json({ keys: [jwk] });
  if (u.pathname === "/authorize") {
    const q = u.searchParams;
    const c = randomBytes(8).toString("hex");
    grants.set(c, { ch: q.get("code_challenge")!, ru: q.get("redirect_uri")!, nonce: q.get("nonce")!, who: { ...who } });
    res.writeHead(302, { location: `${q.get("redirect_uri")}?code=${c}&state=${encodeURIComponent(q.get("state")!)}` });
    return res.end();
  }
  if (u.pathname === "/token") {
    let body = "";
    for await (const ch of req) body += ch;
    const f = new URLSearchParams(body);
    const g = grants.get(f.get("code")!);
    grants.delete(f.get("code")!);
    if (!g || f.get("client_secret") !== "sec" || g.ru !== f.get("redirect_uri") || createHash("sha256").update(f.get("code_verifier")!).digest("base64url") !== g.ch)
      return json({ error: "invalid_grant" }, 400);
    const now = Math.floor(Date.now() / 1000);
    const h = b64({ alg: "RS256", kid: "k1" });
    const p = b64({ iss: ISS, aud: "cid", sub: g.who.sub, nonce: g.nonce, iat: now, exp: now + 600, email: g.who.email });
    const id = `${h}.${p}.${sign("sha256", Buffer.from(`${h}.${p}`), privateKey).toString("base64url")}`;
    return json({ access_token: "at:" + b64(g.who), id_token: id });
  }
  if (u.pathname === "/userinfo") return json(JSON.parse(Buffer.from(String(req.headers.authorization).slice(10), "base64url").toString()));
  json({ error: "nf" }, 404);
});

// ---------- a tiny browser (cookie jar, manual redirects) ----------
function browser() {
  const jar = new Map<string, string>();
  const store = (res: Response) => {
    for (const sc of res.headers.getSetCookie()) {
      const [kv, ...attrs] = sc.split(";");
      const [k, v] = [kv.slice(0, kv.indexOf("=")).trim(), kv.slice(kv.indexOf("=") + 1).trim()];
      const gone = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim())) || v === "";
      if (gone) jar.delete(k);
      else jar.set(k, v);
    }
  };
  const get = async (url: string, init: RequestInit = {}) => {
    const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await fetch(url, { ...init, redirect: "manual", headers: { ...(init.headers as object), ...(url.startsWith(B) && cookie ? { cookie } : {}) } });
    if (url.startsWith(B)) store(res);
    return res;
  };
  /** Follows redirects until it lands on an app page (or leaves for the IdP's logout). */
  const go = async (url: string) => {
    for (let i = 0; i < 10; i++) {
      const res = await get(url);
      const loc = res.headers.get("location");
      if (![301, 302, 303].includes(res.status) || !loc) return url;
      url = new URL(loc, url).toString();
      if ((url.startsWith(B) && !url.startsWith(`${B}/api/`)) || url.startsWith(`${ISS}/logout`)) return url;
    }
    throw new Error("too many redirects");
  };
  const api = async (path: string, headers: Record<string, string> = {}, body?: unknown) => {
    const res = await get(B + path, body === undefined ? { headers } : { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await res.json()) as { c: number; m: string; d: any };
  };
  return { jar, get, go, api };
}

let app: ChildProcess;
let db: DatabaseSync;
const admin = () => db.prepare('SELECT sub FROM "AdminOidcLink" WHERE id = 1').get() as { sub: string } | undefined;
const as = (w: Partial<Who>) => (who = { ...who, ...w });

describe.skipIf(!RUN)("统一登录 · 端到端（已构建的服务 + 假 Casdoor）", () => {
  beforeAll(async () => {
    if (!existsSync(".output/server/index.mjs")) throw new Error("run `npx nuxt build` first");
    const file = join(mkdtempSync(join(tmpdir(), "cb-e2e-")), "e2e.db");
    const env = { ...process.env, DATABASE_URL: `file:${file}` };
    execFileSync("npx", ["prisma", "migrate", "deploy"], { env, stdio: "ignore" });
    db = new DatabaseSync(file);
    db.prepare('INSERT INTO "User"(username, password, name, email) VALUES (?,?,?,?)').run("user1", sha("user1pass12345"), "u1", "user1@example.com");
    await new Promise<void>((r) => idp.listen(IDP_PORT, r));
    app = spawn("node", [".output/server/index.mjs"], {
      env: {
        ...env,
        PORT: String(APP_PORT),
        NUXT_AUTH_SECRET: "e2e-secret",
        NUXT_ADMIN_USERNAME: ADMIN_USER,
        NUXT_ADMIN_PASSWORD: sha(ADMIN_USER + ADMIN_PW),
        NUXT_OIDC_ISSUER: ISS,
        NUXT_OIDC_CLIENT_ID: "cid",
        NUXT_OIDC_CLIENT_SECRET: "sec",
        NUXT_OIDC_REDIRECT_ORIGINS: B,
      },
      stdio: "ignore",
    });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${B}/api/oidc/status`)).ok) return;
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    throw new Error("app did not start");
  }, 60_000);
  afterAll(() => {
    app?.kill();
    idp.close();
    db?.close();
  });

  const adminPwLogin = async (b: ReturnType<typeof browser>) => {
    const r = await b.api("/api/admin/login", {}, { account: ADMIN_USER, password: ADMIN_PW });
    expect(r.c).toBe(200);
    return { Admin: b.jar.get("Admin")! };
  };

  it("user console: verified email links the user; the session is a user one, never an admin one", async () => {
    const b = browser();
    as({ sub: "uuid-1", email: "user1@example.com", email_verified: true });
    expect(await b.go(`${B}/api/oidc/login?next=/flows`)).toBe(`${B}/flows`);
    expect(b.jar.get("Authorization")).toBeTruthy();
    expect(b.jar.has("Admin")).toBe(false);
    const me = await b.api("/api/checkuser", { Authorization: b.jar.get("Authorization")! });
    expect(me.d.username).toBe("user1");
    expect((await b.api("/api/admin/entry/oidc/status", { Authorization: b.jar.get("Authorization")! })).c).toBe(400);
  });

  it("admin console: nothing bound → not_allowed; link / unlink need an admin session", async () => {
    const b = browser();
    as({ sub: "uuid-admin", email: "admin@example.com" });
    expect(await b.go(`${B}/api/oidc/admin/login`)).toBe(`${B}/admin/login?oidc_error=not_allowed`);
    expect(b.jar.has("Admin")).toBe(false);
    expect(await b.go(`${B}/api/oidc/admin/login?mode=link`)).toBe(`${B}/admin?oidc_link=expired`);
    expect((await b.api("/api/admin/entry/oidc/unlink", {}, {})).c).toBe(400);
    // a user session is not an admin session
    as({ sub: "uuid-1", email: "user1@example.com" });
    await b.go(`${B}/api/oidc/login`);
    expect(await b.go(`${B}/api/oidc/admin/login?mode=link`)).toBe(`${B}/admin?oidc_link=expired`);
    expect(admin()).toBeUndefined();
  });

  it("admin binds after a password login, then signs in with the bound sub only; SSO logout", async () => {
    const b = browser();
    const h = await adminPwLogin(b);
    expect((await b.api("/api/admin/entry/oidc/status", h)).d).toMatchObject({ enabled: true, linked: false });
    as({ sub: "uuid-admin", email: "admin@example.com", preferred_username: "adm" });
    expect(await b.go(`${B}/api/oidc/admin/login?mode=link`)).toBe(`${B}/admin?oidc_link=ok`);
    expect(admin()?.sub).toBe("uuid-admin");
    expect((await b.api("/api/admin/entry/oidc/status", h)).d).toMatchObject({ linked: true, name: "adm（admin@example.com）" });
    as({ sub: "uuid-other" });
    expect(await b.go(`${B}/api/oidc/admin/login?mode=link`)).toBe(`${B}/admin?oidc_link=conflict`);
    expect(admin()?.sub).toBe("uuid-admin");
    expect((await b.api("/api/admin/logout")).d).toBe("退出成功"); // password session: no Casdoor logout

    const c = browser();
    as({ sub: "uuid-other", email: "admin@example.com" }); // same email, other sub: refused
    expect(await c.go(`${B}/api/oidc/admin/login`)).toBe(`${B}/admin/login?oidc_error=not_allowed`);
    as({ sub: "uuid-admin" });
    expect(await c.go(`${B}/api/oidc/admin/login`)).toBe(`${B}/admin/`);
    expect(c.jar.get("Admin")).toBe(h.Admin); // exactly the password-login session
    expect(c.jar.has("Authorization")).toBe(false); // never a user session
    expect((await c.api("/api/admin/entry/oidc/status", { Admin: c.jar.get("Admin")! })).c).toBe(200);
    const out = await c.api("/api/admin/logout");
    expect(out.d).toEqual({ sso: true });
    expect(c.jar.has("Admin")).toBe(false);
    const loc = await c.go(`${B}/api/oidc/admin/logout`);
    expect(loc.startsWith(`${ISS}/logout?`)).toBe(true);
    expect(new URL(loc).searchParams.get("post_logout_redirect_uri")).toBe(`${B}/admin/login`);
  });

  it("the bound admin sub cannot get into the user console as admin, and user SSO never yields Admin", async () => {
    const b = browser();
    as({ sub: "uuid-admin", email: "admin@example.com" });
    expect(await b.go(`${B}/api/oidc/login`)).toBe(`${B}/login?oidc_error=no_account`);
    expect(b.jar.has("Admin")).toBe(false);
    expect(b.jar.has("Authorization")).toBe(false);
  });

  it("unlink with an admin session; afterwards the sub is refused", async () => {
    const b = browser();
    const h = await adminPwLogin(b);
    expect((await b.api("/api/admin/entry/oidc/unlink", h, {})).c).toBe(200);
    expect(admin()).toBeUndefined();
    as({ sub: "uuid-admin" });
    expect(await browser().go(`${B}/api/oidc/admin/login`)).toBe(`${B}/admin/login?oidc_error=not_allowed`);
  });

  it("forged state is refused with a fixed code", async () => {
    const b = browser();
    const start = await b.get(`${B}/api/oidc/admin/login`);
    const toIdp = await fetch(start.headers.get("location")!, { redirect: "manual" });
    const cb = new URL(toIdp.headers.get("location")!);
    cb.searchParams.set("state", "forged");
    // the pending cookie says admin-login, so the failure goes to the admin login page
    expect(await b.go(cb.toString())).toBe(`${B}/admin/login?oidc_error=expired`);
    expect(b.jar.has("Admin")).toBe(false);
  });
});
