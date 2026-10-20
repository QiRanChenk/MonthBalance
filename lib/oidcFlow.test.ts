import { describe, expect, it } from "vitest";
import { OidcError, openPending, sealPending, type Identity, type Pending } from "./oidc";
import { checkAdminLink, checkAdminLogin, failPath, flowMode, isAdminMode } from "./oidcFlow";

const id: Identity = { sub: "uuid-1", email: "ckj1@vip.qq.com", emailVerified: true, name: "ckj1", username: "ckj1" };
const code = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return (e as OidcError).code;
  }
  return "ok";
};

describe("统一登录 · 前台 / 后台分流", () => {
  it("mode comes only from the signed cookie; unknown or missing → user login (least privilege)", () => {
    expect(flowMode("admin-login")).toBe("admin-login");
    expect(flowMode("admin-link")).toBe("admin-link");
    expect(flowMode("link")).toBe("link");
    for (const bad of [undefined, null, "", "ADMIN-LOGIN", "admin", 1]) expect(flowMode(bad)).toBe("login");
    expect(isAdminMode("login") || isAdminMode("link")).toBe(false);
    expect(isAdminMode("admin-login") && isAdminMode("admin-link")).toBe(true);
  });

  it("a user-console pending cookie cannot be turned into an admin one (HMAC)", () => {
    const key = Buffer.alloc(32, 7);
    const p: Pending = { state: "s", nonce: "n", verifier: "v", redirectUri: "https://b.test/api/oidc/callback", next: "/", exp: Date.now() + 60_000, mode: "login" };
    const sealed = sealPending(p, key);
    expect(flowMode(openPending(sealed, key)?.mode)).toBe("login");
    const [, mac] = sealed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...p, mode: "admin-login" })).toString("base64url") + "." + mac;
    expect(openPending(forged, key)).toBeNull();
  });

  it("failures land on the console that started the flow, with a fixed code", () => {
    expect(failPath("login", "no_account")).toBe("/login?oidc_error=no_account");
    expect(failPath("link", "conflict")).toBe("/calendar?oidc_link=conflict");
    expect(failPath("admin-login", "not_allowed")).toBe("/admin/login?oidc_error=not_allowed");
    expect(failPath("admin-link", "expired")).toBe("/admin?oidc_link=expired");
  });
});

describe("统一登录 · 后台管理员", () => {
  it("admin login accepts only the bound sub — never by email, nothing bound → not_allowed", () => {
    expect(code(() => checkAdminLogin(id, null))).toBe("not_allowed");
    expect(code(() => checkAdminLogin(id, ""))).toBe("not_allowed");
    expect(code(() => checkAdminLogin(id, "uuid-2"))).toBe("not_allowed");
    expect(code(() => checkAdminLogin({ ...id, sub: "uuid-2" }, "uuid-1"))).toBe("not_allowed"); // same email, other sub
    expect(code(() => checkAdminLogin(id, "uuid-1"))).toBe("ok");
  });

  it("admin link: bind when free or same sub; a different bound sub must be unlinked first", () => {
    expect(code(() => checkAdminLink(id, null))).toBe("ok");
    expect(code(() => checkAdminLink(id, "uuid-1"))).toBe("ok");
    expect(code(() => checkAdminLink(id, "uuid-9"))).toBe("conflict");
  });
});
