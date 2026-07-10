// Multi-tenant auth: email+password (scrypt, node:crypto — no deps),
// kind-scoped session tokens (same HMAC pattern as link/brand/gallery tokens,
// k:"session"), served signup/login pages in the product aesthetic.
//
// Legacy mode preserved: STATUSPASS_CONSOLE_TOKEN still grants the default
// account, so single-tenant design-partner deployments and tests keep working.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// ── Passwords ────────────────────────────────────────────────

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `${salt.toString("base64url")}.${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const dot = stored.indexOf(".");
  if (dot === -1) return false;
  try {
    const salt = Buffer.from(stored.slice(0, dot), "base64url");
    const expected = Buffer.from(stored.slice(dot + 1), "base64url");
    const actual = scryptSync(password, salt, 64);
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

// ── Sessions (kind-scoped tokens, 30-day TTL) ────────────────

const b64u = (b: Buffer) => b.toString("base64url");

export function mintSessionToken(accountId: string, secret: string, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + 30 * 86_400;
  const payload = Buffer.from(JSON.stringify({ k: "session", a: accountId, e: exp }));
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64u(payload)}.${b64u(sig)}`;
}

export function redeemSessionToken(token: string, secret: string, now = new Date()):
  { ok: true; accountId: string } | { ok: false } {
  const dot = token.indexOf(".");
  if (dot === -1) return { ok: false };
  try {
    const payload = Buffer.from(token.slice(0, dot), "base64url");
    const sig = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { ok: false };
    const { k, a, e } = JSON.parse(payload.toString()) as { k: string; a: string; e: number };
    if (k !== "session" || typeof a !== "string") return { ok: false };
    if (Math.floor(now.getTime() / 1000) > e) return { ok: false };
    return { ok: true, accountId: a };
  } catch {
    return { ok: false };
  }
}

export function sessionFromCookie(header: string | undefined, secret: string):
  { ok: true; accountId: string } | { ok: false } {
  if (!header) return { ok: false };
  const m = /(?:^|;\s*)sp_session=([^;]+)/.exec(header);
  return m ? redeemSessionToken(m[1], secret) : { ok: false };
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

// ── Pages ────────────────────────────────────────────────────

function page(title: string, inner: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} — StatusPass</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0B0E16;color:#F2F4F9;margin:0;padding:24px;display:flex;justify-content:center;align-items:center;min-height:90vh}
  main{max-width:380px;width:100%}
  .brand{font-weight:700;font-size:1.2rem;margin-bottom:4px}
  .brand span{color:#C9A96A;font-family:ui-monospace,monospace;font-size:.7rem;letter-spacing:.14em;margin-left:8px}
  p.sub{color:#8A93AB;margin:0 0 24px;font-size:.92rem}
  label{display:block;font-size:.72rem;letter-spacing:.09em;color:#8A93AB;text-transform:uppercase;margin:14px 0 6px}
  input{width:100%;padding:12px;border-radius:10px;border:1px solid #262D40;background:#151A28;color:#F2F4F9;font-size:1rem;box-sizing:border-box}
  button{margin-top:22px;width:100%;padding:13px;border-radius:12px;border:none;background:#C9A96A;color:#0B0E16;font-size:1rem;font-weight:650;cursor:pointer}
  .alt{margin-top:16px;font-size:.85rem;color:#8A93AB;text-align:center}
  .alt a{color:#C9A96A;text-decoration:none}
  .err{color:#D96C6C;margin-top:12px;font-size:.88rem}
</style></head><body><main>
  <div class="brand">StatusPass<span>CONSOLE</span></div>
  ${inner}
</main></body></html>`;
}

export function renderSignupPage(error?: string): string {
  return page("Sign up", `
  <p class="sub">Create your operator account. Your first pass is free.</p>
  <form method="POST" action="/signup">
    <label>Company / operator name</label><input name="name" required maxlength="60" placeholder="Proper Selects">
    <label>Email</label><input name="email" type="email" required placeholder="you@agency.com">
    <label>Password</label><input name="password" type="password" required minlength="8">
    <button>Create account</button>
    ${error ? `<div class="err">${error}</div>` : ""}
  </form>
  <div class="alt">Already set up? <a href="/login">Log in</a></div>`);
}

export function renderLoginPage(error?: string): string {
  return page("Log in", `
  <p class="sub">Welcome back.</p>
  <form method="POST" action="/login">
    <label>Email</label><input name="email" type="email" required>
    <label>Password</label><input name="password" type="password" required>
    <button>Log in</button>
    ${error ? `<div class="err">${error}</div>` : ""}
  </form>
  <div class="alt">New here? <a href="/signup">Create an account</a></div>`);
}
