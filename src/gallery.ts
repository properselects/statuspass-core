// Deliverables gallery — a hosted, auth-free page per pass showing demos,
// links, and pictures of finished work. The pass's primary link points here
// (by default at Delivered/Complete). Same zero-friction rules as everything
// client-facing: tokenized, expiring, no login, rate-limited.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { Deliverable } from "./types.js";
import type { BrandingRecord } from "./branding.js";

// ── Kind-scoped gallery tokens (cannot cross with link/brand tokens) ──

const b64u = (b: Buffer) => b.toString("base64url");

export function mintGalleryToken(passId: string, ttlHours: number, secret: string, now = new Date()): string {
  const exp = ttlHours > 0 ? Math.floor(now.getTime() / 1000) + ttlHours * 3600 : 0;
  const payload = Buffer.from(JSON.stringify({ k: "gallery", p: passId, e: exp }));
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64u(payload)}.${b64u(sig)}`;
}

export type GalleryTokenResult = { ok: true; passId: string } | { ok: false; reason: "bad-token" | "expired" };

export function redeemGalleryToken(token: string, secret: string, now = new Date()): GalleryTokenResult {
  const dot = token.indexOf(".");
  if (dot === -1) return { ok: false, reason: "bad-token" };
  try {
    const payload = Buffer.from(token.slice(0, dot), "base64url");
    const sig = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { ok: false, reason: "bad-token" };
    const { k, p, e } = JSON.parse(payload.toString()) as { k: string; p: string; e: number };
    if (k !== "gallery" || typeof p !== "string") return { ok: false, reason: "bad-token" };
    if (e !== 0 && Math.floor(now.getTime() / 1000) > e) return { ok: false, reason: "expired" };
    return { ok: true, passId: p };
  } catch {
    return { ok: false, reason: "bad-token" };
  }
}

// ── Store surface (implemented by branding stores) ───────────

export interface DeliverableStore {
  listDeliverables(passId: string): Promise<Deliverable[]>;
  addDeliverable(d: Deliverable): Promise<void>;
  removeDeliverable(passId: string, id: string): Promise<void>;
}

export function newDeliverable(
  passId: string,
  input: { kind: "image" | "link"; title: string; assetId?: string; url?: string },
): Deliverable {
  return {
    id: randomUUID(), passId,
    kind: input.kind, title: input.title.slice(0, 80),
    assetId: input.assetId, url: input.url,
    addedAt: new Date().toISOString(),
  };
}

export function validateLinkDeliverable(title: string | undefined, url: string | undefined):
  { ok: true } | { ok: false; error: string } {
  if (!title?.trim()) return { ok: false, error: "Give this deliverable a title." };
  if (!url?.startsWith("http")) return { ok: false, error: "Link must start with http(s)." };
  return { ok: true };
}

// ── The gallery page (client-facing, self-contained) ─────────

export function renderGalleryPage(
  branding: BrandingRecord | null,
  items: Deliverable[],
  assetBase: string, // e.g. https://statuspass.ai/assets
): string {
  const title = branding?.title || "Project deliverables";
  const color = branding?.brandColor ?? "#141826";
  const sorted = [...items].sort((a, b) => b.addedAt.localeCompare(a.addedAt));
  const cards = sorted.map((d) => {
    const when = fmtDate(d.addedAt);
    if (d.kind === "image" && d.assetId) {
      return `<figure class="card"><img src="${assetBase}/${d.assetId}" alt="${esc(d.title)}" loading="lazy">
        <figcaption>${esc(d.title)}<span class="when">${when}</span></figcaption></figure>`;
    }
    if (d.kind === "link" && d.url) {
      return `<a class="card link" href="${esc(d.url)}" rel="noopener">
        <span class="t">${esc(d.title)}<span class="when">${when}</span></span><span class="u">${esc(hostOf(d.url))} →</span></a>`;
    }
    return "";
  }).join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Deliverables</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0e1018;color:#f5f6fa;margin:0;padding:24px;display:flex;justify-content:center}
  main{max-width:560px;width:100%}
  .band{height:6px;border-radius:6px;background:${esc(color)};margin-bottom:18px}
  h1{font-size:1.25rem;margin:0 0 4px}
  p.sub{color:#8a91a8;margin:0 0 22px;font-size:.92rem}
  .grid{display:grid;grid-template-columns:1fr;gap:14px}
  .card{background:#151a28;border:1px solid #262d40;border-radius:14px;overflow:hidden;margin:0}
  .card img{width:100%;display:block}
  .card figcaption{padding:10px 14px;font-size:.9rem;color:#c9cede}
  .card.link{display:flex;justify-content:space-between;align-items:center;padding:16px;text-decoration:none;color:#f5f6fa}
  .card.link .u{color:#8a91a8;font-size:.85rem;white-space:nowrap;margin-left:12px}
  .when{display:block;color:#5d6478;font-size:.75rem;margin-top:2px}
  .empty{color:#8a91a8;text-align:center;padding:40px 0}
</style></head>
<body><main>
  <div class="band"></div>
  <h1>${esc(title)}</h1>
  <p class="sub">Demos and deliverables, newest first — shared by your project team.</p>
  ${items.length ? `<div class="grid">${cards}</div>` : `<div class="empty">Deliverables will appear here as they're completed.</div>`}
</main></body></html>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return "link"; }
}
