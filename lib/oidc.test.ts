// Ported from 邮件签名智能生成器/server/oidc.test.ts; the account mapping is async here (Prisma).
import { beforeEach, describe, expect, it } from 'vitest';
import { createHash, generateKeyPairSync, randomBytes, sign, type JsonWebKey } from 'node:crypto';
import {
  authorizeUrl,
  clearOidcCaches,
  completeLogin,
  discover,
  endSessionUrl,
  linkCheck,
  OidcError,
  openPending,
  pickOrigin,
  resolveLocalUser,
  safeNext,
  sealPending,
  serverSide,
  verifyIdToken,
  type FetchFn,
  type Identity,
  type OidcConfig,
  type Pending,
} from './oidc';

// ---------- a mocked Casdoor ----------

const ISSUER = 'https://auth.example.test';
const INTERNAL = 'http://10.0.0.5:8001';
const CLIENT = 'client-abc';
const SECRET = 'secret-xyz';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { privateKey, jwk: { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid, use: 'sig', alg: 'RS256' } as JsonWebKey };
}
const K1 = keyPair('k1');
const K2 = keyPair('k2');

function jwt(claims: Record<string, unknown>, key = K1, kid = 'k1') {
  const head = b64({ alg: 'RS256', typ: 'JWT', kid });
  const body = b64(claims);
  const sig = sign('sha256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url');
  return `${head}.${body}.${sig}`;
}

type Grant = { challenge: string; redirectUri: string; nonce: string; sub: string };

function mockIdp(opts: { idClaims?: Record<string, unknown>; userinfo?: Record<string, unknown>; keys?: JsonWebKey[]; signWith?: typeof K1; kid?: string } = {}) {
  const grants = new Map<string, Grant>();
  const calls: string[] = [];
  let keys = opts.keys ?? [K1.jwk];
  const fetchFn: FetchFn = async (url, init) => {
    calls.push(url);
    const u = new URL(url);
    const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
    if (u.pathname === '/.well-known/openid-configuration')
      return json({
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/login/oauth/authorize`,
        token_endpoint: `${ISSUER}/api/login/oauth/access_token`,
        userinfo_endpoint: `${ISSUER}/api/userinfo`,
        jwks_uri: `${ISSUER}/.well-known/jwks`,
        end_session_endpoint: `${ISSUER}/api/logout`,
      });
    if (u.pathname === '/.well-known/jwks') return json({ keys });
    if (u.pathname === '/api/login/oauth/access_token') {
      const f = new URLSearchParams(String(init?.body ?? ''));
      const g = grants.get(f.get('code') ?? '');
      if (f.get('client_id') !== CLIENT || f.get('client_secret') !== SECRET) return json({ error: 'invalid_client' }, 400);
      if (!g) return json({ error: 'invalid_grant', error_description: 'unknown code' }, 400);
      if (f.get('redirect_uri') !== g.redirectUri) return json({ error: 'invalid_grant', error_description: 'redirect_uri' }, 400);
      const challenge = createHash('sha256').update(f.get('code_verifier') ?? '').digest('base64url');
      if (challenge !== g.challenge) return json({ error: 'invalid_grant', error_description: 'PKCE verification failed' }, 400);
      grants.delete(f.get('code') ?? '');
      const now = Math.floor(Date.now() / 1000);
      const id = jwt({ iss: ISSUER, aud: [CLIENT], sub: g.sub, nonce: g.nonce, iat: now, exp: now + 3600, email: 'ckj1@vip.qq.com', ...opts.idClaims }, opts.signWith ?? K1, opts.kid ?? 'k1');
      return json({ access_token: 'at-' + g.sub, id_token: id, token_type: 'Bearer', expires_in: 3600 });
    }
    if (u.pathname === '/api/userinfo') {
      const auth = new Headers(init?.headers).get('authorization') ?? '';
      if (!auth.startsWith('Bearer at-')) return json({ error: 'invalid_token' }, 401);
      return json({ sub: auth.slice('Bearer at-'.length), email: 'CKJ1@vip.qq.com', email_verified: true, name: 'ckj1', preferred_username: 'ckj1', ...opts.userinfo });
    }
    return json({ error: 'not found' }, 404);
  };
  /** What the IdP does when the user signs in at authorization_endpoint: remember the request, hand out a code. */
  const authorize = (url: string, sub = 'uuid-1') => {
    const q = new URL(url).searchParams;
    expect(q.get('code_challenge_method')).toBe('S256');
    const code = randomBytes(8).toString('hex');
    grants.set(code, { challenge: q.get('code_challenge')!, redirectUri: q.get('redirect_uri')!, nonce: q.get('nonce')!, sub });
    return { code, state: q.get('state')! };
  };
  return { fetchFn, authorize, calls, setKeys: (k: JsonWebKey[]) => (keys = k) };
}

const cfg: OidcConfig = { issuer: ISSUER, clientId: CLIENT, clientSecret: SECRET };
const pending = (over: Partial<Pending> = {}): Pending => ({
  state: 'st-' + randomBytes(6).toString('hex'),
  nonce: 'no-' + randomBytes(6).toString('hex'),
  verifier: randomBytes(32).toString('base64url'),
  redirectUri: 'https://book.example.test/api/oidc/callback',
  next: '/',
  exp: Date.now() + 600_000,
  ...over,
});

beforeEach(() => clearOidcCaches());

describe('统一登录 · full code + PKCE flow against a mocked IdP', () => {
  it('signs in: authorize URL → code → token → ID token → userinfo', async () => {
    const idp = mockIdp();
    const doc = await discover(cfg, idp.fetchFn);
    const p = pending();
    const url = authorizeUrl(doc, cfg, p);
    const q = new URL(url).searchParams;
    expect(url.startsWith(`${ISSUER}/login/oauth/authorize?`)).toBe(true);
    expect(q.get('client_id')).toBe(CLIENT);
    expect(q.get('scope')).toBe('openid profile email');
    expect(q.get('code_challenge')).not.toBe(p.verifier);
    const { code, state } = idp.authorize(url);
    expect(state).toBe(p.state);
    const who = await completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn);
    expect(who).toEqual({ sub: 'uuid-1', email: 'ckj1@vip.qq.com', emailVerified: true, name: 'ckj1', username: 'ckj1' });
  });

  it('takes discovery + JWKS from the public issuer; only token + userinfo use the internal address', async () => {
    const idp = mockIdp();
    const c = { ...cfg, internalUrl: INTERNAL };
    const doc = await discover(c, idp.fetchFn);
    const p = pending();
    const url = authorizeUrl(doc, c, p);
    expect(url.startsWith(ISSUER)).toBe(true);
    const { code } = idp.authorize(url);
    await completeLogin(c, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn);
    const path = (u: string) => new URL(u).pathname;
    expect(idp.calls.filter((u) => u.startsWith(INTERNAL)).map(path).sort()).toEqual(['/api/login/oauth/access_token', '/api/userinfo']);
    expect(idp.calls.filter((u) => u.startsWith(ISSUER)).map(path).sort()).toEqual(['/.well-known/jwks', '/.well-known/openid-configuration']);
    expect(serverSide('https://elsewhere.test/x', c)).toBe('https://elsewhere.test/x');
  });

  it('fails when the PKCE verifier does not match', async () => {
    const idp = mockIdp();
    const p = pending();
    const { code } = idp.authorize(authorizeUrl(await discover(cfg, idp.fetchFn), cfg, p));
    await expect(completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: 'wrong', nonce: p.nonce }, idp.fetchFn)).rejects.toThrow(/PKCE/);
  });

  it('fails on a wrong client secret', async () => {
    const idp = mockIdp();
    const p = pending();
    const { code } = idp.authorize(authorizeUrl(await discover(cfg, idp.fetchFn), cfg, p));
    await expect(completeLogin({ ...cfg, clientSecret: 'nope' }, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn)).rejects.toThrow(
      /invalid_client/,
    );
  });

  it.each([
    ['nonce', { nonce: 'replayed' }, /nonce/],
    ['audience', { aud: ['someone-else'] }, /aud/],
    ['issuer', { iss: 'https://evil.test' }, /iss/],
    ['expiry', { exp: Math.floor(Date.now() / 1000) - 3600 }, /过期/],
  ])('rejects an ID token with the wrong %s', async (_n, idClaims, err) => {
    const idp = mockIdp({ idClaims });
    const p = pending();
    const { code } = idp.authorize(authorizeUrl(await discover(cfg, idp.fetchFn), cfg, p));
    await expect(completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn)).rejects.toThrow(err);
  });

  it('rejects an ID token signed by a key the IdP does not publish', async () => {
    const idp = mockIdp({ signWith: K2, kid: 'k1' });
    const p = pending();
    const { code } = idp.authorize(authorizeUrl(await discover(cfg, idp.fetchFn), cfg, p));
    await expect(completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn)).rejects.toThrow(/签名无效/);
  });

  it('refetches the JWKS once when the signing key was rotated', async () => {
    const idp = mockIdp({ signWith: K2, kid: 'k2' });
    idp.setKeys([K1.jwk]);
    const doc = await discover(cfg, idp.fetchFn);
    // warm the cache with the old key set
    const p0 = pending();
    const first = idp.authorize(authorizeUrl(doc, cfg, p0));
    await expect(completeLogin(cfg, { code: first.code, redirectUri: p0.redirectUri, verifier: p0.verifier, nonce: p0.nonce }, idp.fetchFn)).rejects.toThrow(/公钥/);
    idp.setKeys([K1.jwk, K2.jwk]);
    const p = pending();
    const { code } = idp.authorize(authorizeUrl(doc, cfg, p));
    await expect(completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn)).resolves.toMatchObject({ sub: 'uuid-1' });
  });

  it('only reports a verified email when the IdP says email_verified: true', async () => {
    for (const [v, want] of [[false, false], ['true', false], [undefined, false]] as const) {
      clearOidcCaches();
      const idp = mockIdp({ userinfo: { email_verified: v } });
      const p = pending();
      const { code } = idp.authorize(authorizeUrl(await discover(cfg, idp.fetchFn), cfg, p));
      const who = await completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn);
      expect(who.emailVerified).toBe(want);
    }
  });

  it('rejects userinfo that belongs to another subject', async () => {
    const idp = mockIdp({ userinfo: { sub: 'someone-else' } });
    const p = pending();
    const { code } = idp.authorize(authorizeUrl(await discover(cfg, idp.fetchFn), cfg, p));
    await expect(completeLogin(cfg, { code, redirectUri: p.redirectUri, verifier: p.verifier, nonce: p.nonce }, idp.fetchFn)).rejects.toThrow(/同一个用户/);
  });

  it('refuses a discovery document for another issuer', async () => {
    const idp = mockIdp();
    await expect(discover({ ...cfg, issuer: 'https://other.test' }, idp.fetchFn)).rejects.toThrow(/issuer/);
  });

  it('builds the IdP logout URL with client_id and the post-logout address', async () => {
    const idp = mockIdp();
    const u = new URL(endSessionUrl(await discover(cfg, idp.fetchFn), cfg, 'https://sig.example.test/')!);
    expect(u.origin + u.pathname).toBe(`${ISSUER}/api/logout`);
    expect(u.searchParams.get('client_id')).toBe(CLIENT);
    expect(u.searchParams.get('post_logout_redirect_uri')).toBe('https://sig.example.test/');
  });
});

describe('统一登录 · pending-login cookie', () => {
  const key = randomBytes(32);
  it('round-trips and rejects tampering, other keys and expiry', () => {
    const p = pending();
    const v = sealPending(p, key);
    expect(openPending(v, key)).toEqual(p);
    const [body, mac] = v.split('.');
    const forged = Buffer.from(JSON.stringify({ ...p, next: '/evil' })).toString('base64url');
    expect(openPending(`${forged}.${mac}`, key)).toBeNull();
    expect(openPending(`${body}.${mac}x`, key)).toBeNull();
    expect(openPending(v, randomBytes(32))).toBeNull();
    expect(openPending(v, key, p.exp + 1)).toBeNull();
    expect(openPending(undefined, key)).toBeNull();
  });

  it('verifyIdToken needs the nonce of this browser', () => {
    const now = Math.floor(Date.now() / 1000);
    const t = jwt({ iss: ISSUER, aud: CLIENT, sub: 's', nonce: 'n1', exp: now + 60 });
    expect(verifyIdToken(t, { issuer: ISSUER, clientId: CLIENT, nonce: 'n1', keys: [K1.jwk] }).sub).toBe('s');
    expect(() => verifyIdToken(t, { issuer: ISSUER, clientId: CLIENT, nonce: 'n2', keys: [K1.jwk] })).toThrow(/nonce/);
  });
});

describe('统一登录 · redirect address and next', () => {
  const allowed = ['https://sig.mmkj.site', 'https://n2.mmkj.site:5002', 'http://localhost:5173'];
  it('picks the allowed site address the request came in on', () => {
    expect(pickOrigin('https://sig.mmkj.site', allowed)).toBe('https://sig.mmkj.site');
    // behind a proxy without TRUST_PROXY the scheme looks like http
    expect(pickOrigin('http://sig.mmkj.site', allowed)).toBe('https://sig.mmkj.site');
    // nginx `Host: $host` drops the port
    expect(pickOrigin('http://n2.mmkj.site', allowed)).toBe('https://n2.mmkj.site:5002');
    expect(pickOrigin('https://n2.mmkj.site:5002', allowed)).toBe('https://n2.mmkj.site:5002');
    expect(pickOrigin('http://localhost:5173', allowed)).toBe('http://localhost:5173');
    expect(pickOrigin('https://n2.mmkj.site:5017', allowed)).toBeNull();
    expect(pickOrigin('https://evil.test', allowed)).toBeNull();
    expect(pickOrigin('http://n2.mmkj.site', [...allowed, 'https://n2.mmkj.site:5003'])).toBeNull();
  });

  it('only keeps same-site relative paths', () => {
    expect(safeNext('/p/1?x=2')).toBe('/p/1?x=2');
    expect(safeNext('//evil.test')).toBe('/');
    expect(safeNext('/\\evil.test')).toBe('/');
    expect(safeNext('https://evil.test')).toBe('/');
    expect(safeNext(undefined)).toBe('/');
  });
});

describe('统一登录 · mapping to a local account', () => {
  type U = { id: string; email?: string; username: string; disabled: number; oidc_sub?: string | null; admin?: boolean };
  const id: Identity = { sub: 'uuid-1', email: 'ckj1@vip.qq.com', emailVerified: true, name: '陈', username: 'ckj1' };
  function store(users: U[], autoCreate = true) {
    return {
      users,
      deps: {
        autoCreate,
        bySub: (s: string) => users.find((u) => u.oidc_sub === s),
        byEmail: (e: string) => users.find((u) => u.email === e) ?? users.find((u) => u.username.toLowerCase() === e),
        isAdmin: (u: U) => Boolean(u.admin),
        create: (i: Identity) => {
          const u: U = { id: 'new', username: i.email, disabled: 0 };
          users.push(u);
          return u;
        },
        // like the SQL: only when not linked yet
        link: (u: U, i: Identity) => {
          if (u.oidc_sub) return false;
          u.oidc_sub = i.sub;
          return true;
        },
      },
    };
  }
  const code = async (f: () => unknown) => {
    try {
      await f();
    } catch (e) {
      return (e as OidcError).code;
    }
    return 'ok';
  };

  it('matches an unlinked non-admin account named by its email and links it', async () => {
    const s = store([{ id: 'a', username: 'CKJ1@vip.qq.com', disabled: 0 }]);
    expect(await resolveLocalUser(id, s.deps)).toMatchObject({ user: { id: 'a' }, created: false });
    expect(s.users[0].oidc_sub).toBe('uuid-1');
  });

  it('prefers the account already linked to the subject (also admins that linked themselves)', async () => {
    const s = store([
      { id: 'a', username: 'ckj1@vip.qq.com', disabled: 0 },
      { id: 'b', username: 'chen', disabled: 0, oidc_sub: 'uuid-1', admin: true },
    ]);
    expect((await resolveLocalUser(id, s.deps)).user.id).toBe('b');
  });

  it('never links by an unverified email', async () => {
    const s = store([{ id: 'a', username: 'ckj1@vip.qq.com', disabled: 0 }]);
    expect(await code(() => resolveLocalUser({ ...id, emailVerified: false }, s.deps))).toBe('unverified');
    expect(s.users[0].oidc_sub).toBeUndefined();
    expect(await code(() => resolveLocalUser({ ...id, emailVerified: false }, store([]).deps))).toBe('unverified');
  });

  it('never auto-links an admin account', async () => {
    const s = store([{ id: 'a', username: 'ckj1@vip.qq.com', disabled: 0, admin: true }]);
    expect(await code(() => resolveLocalUser(id, s.deps))).toBe('admin_link');
    expect(s.users[0].oidc_sub).toBeUndefined();
  });

  it('refuses an email whose account is linked to another subject, and never overwrites the link', async () => {
    const s = store([{ id: 'a', username: 'ckj1@vip.qq.com', disabled: 0, oidc_sub: 'uuid-OTHER' }]);
    expect(await code(() => resolveLocalUser(id, s.deps))).toBe('conflict');
    expect(s.users[0].oidc_sub).toBe('uuid-OTHER');
    expect(s.users).toHaveLength(1);
  });

  it('creates a plain (non-admin) user when nothing matches (auto-create on), refuses when off', async () => {
    const r = await resolveLocalUser(id, store([]).deps);
    expect(r).toMatchObject({ user: { id: 'new', username: 'ckj1@vip.qq.com', oidc_sub: 'uuid-1' }, created: true });
    expect(r.user.admin).toBeUndefined();
    expect(await code(() => resolveLocalUser(id, store([], false).deps))).toBe('no_account');
  });

  it('refuses disabled accounts and identities without email', async () => {
    expect(await code(() => resolveLocalUser(id, store([{ id: 'a', username: 'ckj1@vip.qq.com', disabled: 1 }]).deps))).toBe('disabled');
    expect(await code(() => resolveLocalUser(id, store([{ id: 'b', username: 'x', disabled: 1, oidc_sub: 'uuid-1' }]).deps))).toBe('disabled');
    expect(await code(() => resolveLocalUser({ ...id, email: '' }, store([]).deps))).toBe('no_account');
  });

  it('link mode: the signed-in account takes the identity unless either side is linked elsewhere', async () => {
    const me: U = { id: 'me', username: 'ckj1', disabled: 0, admin: true };
    const other: U = { id: 'o', username: 'x', disabled: 0, oidc_sub: 'uuid-9' };
    const bySub = (s: string) => [me, other].find((u) => u.oidc_sub === s);
    expect(await code(() => linkCheck(me, id, bySub))).toBe('ok');
    expect(await code(() => linkCheck(me, { ...id, sub: 'uuid-9' }, bySub))).toBe('conflict');
    expect(await code(() => linkCheck({ ...me, oidc_sub: 'uuid-2' }, id, bySub))).toBe('conflict');
    expect(await code(() => linkCheck({ ...me, oidc_sub: 'uuid-1' }, id, bySub))).toBe('ok');
  });
});
