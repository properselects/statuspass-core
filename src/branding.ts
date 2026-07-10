// Branding intake — the "design phase" for the client, inside StatusPass.
// The operator sends the client a one-time tokenized link; the client uploads
// a logo (optionally a strip image) and picks a brand color. No account, no
// vendor exposure — the zero-friction thesis applied to onboarding.
//
// Assets are stored behind BrandingStore (in-memory for dev; swap Supabase
// Storage in prod) and served at /assets/{id} so the vendor spec's
// logoUrl/stripImageUrl point at StatusPass-hosted URLs.

import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { PassBranding } from "./passdesign.js";
import type { Deliverable } from "./types.js";
import type { DeliverableStore } from "./gallery.js";

// ── Store ────────────────────────────────────────────────────

export interface StoredAsset {
  id: string;
  contentType: string; // image/png, image/jpeg, image/webp
  bytes: Buffer;
}

export interface BrandingRecord {
  passId: string;
  title: string;
  operatorName: string;
  brandColor?: string;
  logoAssetId?: string;
  stripAssetId?: string;
  completedAt?: string;
}

export interface BrandingStore extends DeliverableStore {
  getBranding(passId: string): Promise<BrandingRecord | null>;
  saveBranding(record: BrandingRecord): Promise<void>;
  saveAsset(asset: StoredAsset): Promise<void>;
  getAsset(id: string): Promise<StoredAsset | null>;
}

export class InMemoryBrandingStore implements BrandingStore {
  branding = new Map<string, BrandingRecord>();
  assets = new Map<string, StoredAsset>();
  async getBranding(passId: string) { return this.branding.get(passId) ?? null; }
  async saveBranding(r: BrandingRecord) { this.branding.set(r.passId, r); }
  async saveAsset(a: StoredAsset) { this.assets.set(a.id, a); }
  async getAsset(id: string) { return this.assets.get(id) ?? null; }
  deliverables = new Map<string, Deliverable[]>();
  async listDeliverables(passId: string) { return this.deliverables.get(passId) ?? []; }
  async addDeliverable(d: Deliverable) {
    const arr = this.deliverables.get(d.passId) ?? [];
    arr.push(d); this.deliverables.set(d.passId, arr);
  }
  async removeDeliverable(passId: string, id: string) {
    this.deliverables.set(passId, (this.deliverables.get(passId) ?? []).filter((d) => d.id !== id));
  }
}

/** Resolve a PassBranding for the adapter from a stored record. */
export function toPassBranding(r: BrandingRecord, publicBaseUrl: string, whiteLabel = false): PassBranding {
  return {
    title: r.title,
    operatorName: r.operatorName,
    whiteLabel,
    brandColor: r.brandColor,
    logoUrl: r.logoAssetId ? `${publicBaseUrl}/assets/${r.logoAssetId}` : undefined,
    stripImageUrl: r.stripAssetId ? `${publicBaseUrl}/assets/${r.stripAssetId}` : undefined,
  };
}

// ── One-time branding tokens (kind-scoped) ───────────────────
// Deliberately NOT the same payload shape as link tokens: the payload
// carries k:"brand" and is validated, so a branding token can never be
// redeemed at /l/ and a link token can never open the intake page.

const b64u = (b: Buffer) => b.toString("base64url");

export function mintBrandingToken(passId: string, ttlHours: number, secret: string, now = new Date()): string {
  const exp = Math.floor(now.getTime() / 1000) + ttlHours * 3600;
  const payload = Buffer.from(JSON.stringify({ k: "brand", p: passId, e: exp }));
  const sig = createHmac("sha256", secret).update(payload).digest();
  return `${b64u(payload)}.${b64u(sig)}`;
}

export type BrandTokenResult = { ok: true; passId: string } | { ok: false; reason: "bad-token" | "expired" };

export function redeemBrandingToken(token: string, secret: string, now = new Date()): BrandTokenResult {
  const dot = token.indexOf(".");
  if (dot === -1) return { ok: false, reason: "bad-token" };
  try {
    const payload = Buffer.from(token.slice(0, dot), "base64url");
    const sig = Buffer.from(token.slice(dot + 1), "base64url");
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (sig.length !== expected.length || !timingSafeEqual(sig, expected)) return { ok: false, reason: "bad-token" };
    const { k, p, e } = JSON.parse(payload.toString()) as { k: string; p: string; e: number };
    if (k !== "brand" || typeof p !== "string") return { ok: false, reason: "bad-token" };
    if (Math.floor(now.getTime() / 1000) > e) return { ok: false, reason: "expired" };
    return { ok: true, passId: p };
  } catch {
    return { ok: false, reason: "bad-token" };
  }
}

// ── Upload validation ────────────────────────────────────────

const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_BYTES = 2 * 1024 * 1024; // 2MB — pass images are small by spec
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;

export type UploadResult = { ok: true; assetId: string } | { ok: false; error: string };

export async function handleAssetUpload(
  store: BrandingStore,
  passId: string,
  slot: "logo" | "strip",
  contentType: string | undefined,
  bytes: Buffer,
): Promise<UploadResult> {
  if (!contentType || !ALLOWED_TYPES.has(contentType)) {
    return { ok: false, error: "Use a PNG, JPEG, or WebP image." };
  }
  if (bytes.length === 0 || bytes.length > MAX_BYTES) {
    return { ok: false, error: "Image must be under 2MB." };
  }
  const asset: StoredAsset = { id: randomUUID(), contentType, bytes };
  await store.saveAsset(asset);

  const record = (await store.getBranding(passId)) ?? {
    passId, title: "", operatorName: "",
  };
  if (slot === "logo") record.logoAssetId = asset.id;
  else record.stripAssetId = asset.id;
  await store.saveBranding(record);
  return { ok: true, assetId: asset.id };
}

export async function handleBrandingSubmit(
  store: BrandingStore,
  passId: string,
  fields: { title?: string; brandColor?: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (fields.brandColor && !HEX_COLOR.test(fields.brandColor)) {
    return { ok: false, error: "Color must be a hex value like #1B2A4A." };
  }
  const record = (await store.getBranding(passId)) ?? { passId, title: "", operatorName: "" };
  if (fields.title) record.title = fields.title.slice(0, 60);
  if (fields.brandColor) record.brandColor = fields.brandColor;
  record.completedAt = new Date().toISOString();
  await store.saveBranding(record);
  return { ok: true };
}

// ── The intake page (self-contained, no client-side deps) ────

export function renderIntakePage(token: string, existing: BrandingRecord | null): string {
  const title = existing?.title ?? "";
  const color = existing?.brandColor ?? "#141826";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Set up your project pass</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0e1018;color:#f5f6fa;margin:0;padding:24px;display:flex;justify-content:center}
  main{max-width:420px;width:100%}
  h1{font-size:1.35rem;margin:0 0 4px}
  p.sub{color:#8a91a8;margin:0 0 24px;font-size:.95rem}
  label{display:block;font-size:.8rem;letter-spacing:.06em;color:#8a91a8;margin:18px 0 6px;text-transform:uppercase}
  input[type=text]{width:100%;padding:12px;border-radius:10px;border:1px solid #2a2f42;background:#171a26;color:#f5f6fa;font-size:1rem;box-sizing:border-box}
  input[type=color]{width:64px;height:40px;border:none;background:none;padding:0}
  input[type=file]{color:#8a91a8;font-size:.9rem}
  button{margin-top:28px;width:100%;padding:14px;border-radius:12px;border:none;background:#f5f6fa;color:#0e1018;font-size:1rem;font-weight:600}
  .ok{color:#7dd6a0;margin-top:14px}.err{color:#e08a8a;margin-top:14px}
</style></head>
<body><main>
  <h1>Set up your project pass</h1>
  <p class="sub">Add your logo and brand color. This is how your project status will look in your wallet.</p>
  <label>Project name</label>
  <input type="text" id="title" value="${title.replace(/"/g, "&quot;")}" placeholder="Acme Website">
  <label>Brand color</label>
  <input type="color" id="color" value="${color}">
  <label>Logo (PNG, JPEG, or WebP — square works best)</label>
  <input type="file" id="logo" accept="image/png,image/jpeg,image/webp">
  <button id="save">Save</button>
  <div id="msg"></div>
  <script>
    const t=${JSON.stringify(token)};
    const msg=(c,s)=>{const m=document.getElementById('msg');m.className=c;m.textContent=s};
    document.getElementById('save').onclick=async()=>{
      try{
        const f=document.getElementById('logo').files[0];
        if(f){
          const r=await fetch('/brand/'+t+'/upload?slot=logo',{method:'POST',headers:{'content-type':f.type},body:f});
          if(!r.ok){msg('err',(await r.json()).error||'Upload failed');return}
        }
        const r2=await fetch('/brand/'+t,{method:'POST',headers:{'content-type':'application/json'},
          body:JSON.stringify({title:document.getElementById('title').value,brandColor:document.getElementById('color').value})});
        if(!r2.ok){msg('err',(await r2.json()).error||'Save failed');return}
        const data=await r2.json();
        if(data.addUrl){
          msg('ok','Saved — your pass is ready.');
          const a=document.createElement('a');a.href=data.addUrl;a.textContent='Add to your wallet';
          a.style.cssText='display:block;text-align:center;margin-top:14px;padding:14px;border-radius:12px;background:#f5f6fa;color:#0e1018;font-weight:600;text-decoration:none';
          document.getElementById('msg').after(a);
        } else {
          msg('ok','Saved. Your pass is being prepared — you\'ll receive an add link shortly.');
        }
      }catch(e){msg('err','Something went wrong. Try again.')}
    };
  </script>
</main></body></html>`;
}
