// resolvePrimaryLink + token redemption — build doc §6, prompt spec link rules.
// The link target must survive a non-technical exec tapping it cold:
// no login wall, no request-access screen. We tokenize (unguessable, expiring)
// and verify reachable + auth-free BEFORE shipping. A dead or gated link is
// worse than no link.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { BoardEvent, ResolvedRules } from "./types.js";
import type { ResolvedLink } from "./pipeline.js";
import { mintGalleryToken } from "./gallery.js";

// ── Tokenization ─────────────────────────────────────────────
// token = base64url(payload) + "." + base64url(hmacSHA256(payload, secret))
// payload = JSON { u: url, e: epochSeconds }
// Redeemed at GET /l/:token → 302 to url. Unguessable, expiring, revocable
// by secret rotation. NOT an auth gate — by design.

const b64u = (buf: Buffer) => buf.toString("base64url");

export function mintLinkToken(url: string, ttlHours: number, secret: string, now = new Date()): string {
  const exp = ttlHours > 0 ? Math.floor(now.getTime() / 1000) + ttlHours * 3600 : 0; // 0 = no expiry
  const payload = Buffer.from(JSON.stringify({ u: url, e: exp }));
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64u(payload)}.${b64u(sig)}`;
}

export type RedeemResult = { ok: true; url: string } | { ok: false; reason: "bad-token" | "expired" };

export function redeemLinkToken(token: string, secret: string, now = new Date()): RedeemResult {
  const dot = token.indexOf(".");
  if (dot === -1) return { ok: false, reason: "bad-token" };
  try {
    const payload = Buffer.from(token.slice(0, dot), "base64url");
    const sig = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) {
      return { ok: false, reason: "bad-token" };
    }
    const { u, e } = JSON.parse(payload.toString()) as { u: string; e: number };
    if (typeof u !== "string" || !u.startsWith("http")) return { ok: false, reason: "bad-token" };
    if (e !== 0 && Math.floor(now.getTime() / 1000) > e) return { ok: false, reason: "expired" };
    return { ok: true, url: u };
  } catch {
    return { ok: false, reason: "bad-token" };
  }
}

// ── Reachability / auth-wall check ───────────────────────────
// Conservative: 2xx ok; redirects to login-ish URLs, 401/403, or network
// failure → not shippable. False negative (skipping a good link) costs a
// link; false positive ships a broken promise to a CEO's lock screen.

const LOGIN_HINT = /(login|signin|sign-in|auth|sso|account\/access)/i;

export type Fetcher = (url: string, init: { method: string; redirect: "follow" }) => Promise<{
  ok: boolean; status: number; url: string;
}>;

export async function isReachableAuthFree(url: string, fetcher: Fetcher = fetch as unknown as Fetcher): Promise<boolean> {
  try {
    // HEAD first; some hosts reject HEAD → fall back to GET
    for (const method of ["HEAD", "GET"] as const) {
      try {
        const res = await fetcher(url, { method, redirect: "follow" });
        if (res.status === 401 || res.status === 403) return false;
        if (LOGIN_HINT.test(res.url) && res.url !== url) return false; // redirected to a login wall
        if (res.ok) return true;
        if (method === "GET") return false;
      } catch {
        if (method === "GET") return false;
      }
    }
    return false;
  } catch {
    return false;
  }
}

// ── The resolver injected into the pipeline ──────────────────

export interface LinkResolverConfig {
  tokenSecret: string;
  /** Public base for redemption, e.g. https://statuspass.ai/l */
  redeemBaseUrl: string;
  /** Public base for the deliverables gallery, e.g. https://statuspass.ai/g */
  galleryBaseUrl?: string;
  /** Whether this pass has any deliverables (gallery source resolves only if true). */
  hasDeliverables?(passId: string): Promise<boolean>;
  fetcher?: Fetcher;
  now?(): Date;
}

/**
 * Per link rules: find the source URL for this phase (board field → static →
 * fallback), verify it if required, tokenize, return { label, url } or null.
 * Never ship a broken or gated link — fall back or return null.
 */
export function makeResolvePrimaryLink(config: LinkResolverConfig) {
  return async function resolvePrimaryLink(
    phase: string,
    event: BoardEvent,
    rules: ResolvedRules["link"],
    passId?: string,
  ): Promise<ResolvedLink | null> {
    const now = config.now?.() ?? new Date();
    const entry = rules.byPhase[phase];

    let label: string | undefined;
    let rawUrl: string | undefined;

    if (entry) {
      label = entry.label;
      if (entry.source.type === "board_field") {
        rawUrl = event.fields?.[entry.source.fieldKey];
      } else if (entry.source.type === "static") {
        rawUrl = entry.source.url;
      } else if (entry.source.type === "gallery") {
        const g = await galleryLink(label);
        if (g) return g;
        rawUrl = undefined; // empty gallery falls through
      }
    }

    // The gallery is a living demo shelf: once populated, it's reachable
    // from ANY phase — if the phase's own source produced nothing, offer
    // the gallery before the static fallback.
    if (!rawUrl) {
      const g = await galleryLink("View demos & deliverables");
      if (g) return g;
    }

    // Our own hosted gallery: auth-free by construction, always up — no
    // reachability check. Non-expiring token (unguessable; the shelf is a
    // lasting surface, and a dead link on a kept pass breaks the promise).
    // Resolves only if deliverables exist — never link an empty page.
    async function galleryLink(l: string | undefined): Promise<ResolvedLink | null> {
      if (!passId || !config.galleryBaseUrl || !l) return null;
      if (!(await config.hasDeliverables?.(passId))) return null;
      const token = mintGalleryToken(passId, 0, config.tokenSecret, now);
      return { label: l, url: `${config.galleryBaseUrl}/${token}` };
    }

    // fall back if phase had no link or the field was empty
    if (!rawUrl && rules.fallback) {
      label = rules.fallback.label;
      rawUrl = rules.fallback.url;
    }
    if (!rawUrl || !label || !rawUrl.startsWith("http")) return null;

    if (rules.verifyReachable) {
      const okDirect = await isReachableAuthFree(rawUrl, config.fetcher);
      if (!okDirect) {
        // try the fallback once if we weren't already on it
        if (rules.fallback && rawUrl !== rules.fallback.url) {
          const fb = rules.fallback;
          if (await isReachableAuthFree(fb.url, config.fetcher)) {
            rawUrl = fb.url;
            label = fb.label;
          } else return null;
        } else return null;
      }
    }

    const token = mintLinkToken(rawUrl, rules.tokenTtlHours, config.tokenSecret, now);
    const expiresAt = rules.tokenTtlHours > 0
      ? new Date(now.getTime() + rules.tokenTtlHours * 3_600_000).toISOString()
      : undefined;

    return { label, url: `${config.redeemBaseUrl}/${token}`, expiresAt };
  };
}
