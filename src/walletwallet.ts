// WalletWallet adapter — implements PassDeliveryAdapter against the
// VERIFIED API (walletwallet.dev, fetched 2026-07):
//   Base: https://api.walletwallet.dev
//   POST /api/passes          → { serialNumber, googleSaveUrl, applePass, shareUrl }
//   PUT  /api/passes/{serial} → full body REPLACE (omitted fields dropped),
//                               identical bodies are no-ops (no push, no quota)
//   Auth: Bearer ww_live_...
// Verified schema notes:
//   - barcodeValue + barcodeFormat ("QR"|"PDF417"|"Aztec"|"Code128"), both required
//   - fields are {label, value, changeMessage?} on header/primary/secondary/back
//     (no auxiliaryFields — ours fold into secondaryFields)
//   - only the FIRST primaryField renders
//   - color: custom hex (Pro); logoURL/thumbnailURL/stripURL/iconURL (Pro)
//   - organizationName = notification title on updates
//   - response.shareUrl = hosted install page (right wallet per device)
// The design IR stays in passdesign.ts; toWWBody() below is the only place
// that knows the vendor's wire shape.

import type { Pass, Profile, RagStatus } from "./types.js";
import type { ResolvedLink } from "./pipeline.js";
import type { PassDeliveryAdapter } from "./app.js";
import { buildPassSpec, type PassBranding, type PassContent } from "./passdesign.js";
import { SYSTEM_DEFAULTS } from "./defaults.js";

export interface WalletWalletConfig {
  apiKey: string; // ww_live_...
  baseUrl?: string;
  /** Look up branding + vendor serial + milestone for a pass. */
  getPassMeta(pass: Pass): Promise<{
    serial: string | null;      // null → not yet issued
    branding: PassBranding;
    nextMilestone?: string;
    lastDeliverable?: string;   // newest shelf item title
  }>;
  /** Persist the vendor serial after first issuance. */
  saveSerial(passId: string, serial: string): Promise<void>;
  fetchImpl?: typeof fetch;
}

interface WWCreateResponse {
  serialNumber: string;
  googleSaveUrl: string;
  applePass: string; // base64 .pkpass
  shareUrl: string;  // hosted install page
}

/** Map our design IR (WalletWalletPassSpec) to the verified wire shape. */
export function toWWBody(spec: ReturnType<typeof buildPassSpec>): Record<string, unknown> {
  const f = (arr: Array<{ label: string; value: string; changeMessage?: string }>) =>
    arr.map(({ label, value, changeMessage }) =>
      changeMessage ? { label, value, changeMessage } : { label, value });
  return {
    // barcode is REQUIRED by the API; fall back to the share page target
    // (the pass itself) when no context link exists yet.
    barcodeValue: spec.barcode?.message ?? spec.description,
    barcodeFormat: "QR",
    logoText: spec.logoText,
    description: spec.description,
    organizationName: spec.organizationName, // notification title on updates
    headerFields: f(spec.headerFields),
    primaryFields: f(spec.primaryFields),    // only [0] renders — ours is single
    secondaryFields: f([...spec.secondaryFields, ...spec.auxiliaryFields]),
    backFields: f(spec.backFields),
    color: spec.backgroundColor,             // custom hex (Pro)
    ...(spec.logoUrl ? { logoURL: spec.logoUrl } : {}),
    ...(spec.thumbnailUrl ? { thumbnailURL: spec.thumbnailUrl } : {}),
    ...(spec.stripImageUrl ? { stripURL: spec.stripImageUrl } : {}),
    sharingProhibited: true, // status passes carry private project info
  };
}

export interface IssueResult {
  serial: string;
  /** Hand this to the operator: hosted page with the right Add button. */
  addUrl: string;
  googleSaveUrl: string;
}

export function createWalletWalletAdapter(config: WalletWalletConfig): PassDeliveryAdapter & {
  issuePass(pass: Pass, content: PassContent): Promise<IssueResult>;
} {
  const base = (config.baseUrl ?? "https://api.walletwallet.dev").replace(/\/$/, "");
  const doFetch = config.fetchImpl ?? fetch;

  async function ww(path: string, method: "POST" | "PUT", body: unknown): Promise<Response> {
    const res = await doFetch(`${base}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`walletwallet ${method} ${path} → ${res.status}: ${await res.text()}`);
    return res;
  }

  function specFor(pass: Pass, branding: PassBranding, content: PassContent) {
    const phaseOrder = SYSTEM_DEFAULTS[pass.profile as Profile].mapping.phaseOrder;
    return buildPassSpec(pass.profile as Profile, branding, content, phaseOrder);
  }

  return {
    /** First-time issuance: create on vendor, persist serial, return the add link. */
    async issuePass(pass, content) {
      const meta = await config.getPassMeta(pass);
      const spec = specFor(pass, meta.branding, content);
      const res = await ww("/api/passes", "POST", toWWBody(spec));
      const data = (await res.json()) as WWCreateResponse;
      await config.saveSerial(pass.id, data.serialNumber);
      return {
        serial: data.serialNumber,
        addUrl: data.shareUrl, // vendor-hosted install page, from the response
        googleSaveUrl: data.googleSaveUrl,
      };
    },

    /** Pipeline delivery: PUT the full new spec — pushes both wallets.
     *  Identical bodies don't trigger a push on their side (free anti-spam). */
    async pushUpdate(pass, payload: {
      phase: string; rag: RagStatus | null; text: string; link: ResolvedLink | null;
    }) {
      const meta = await config.getPassMeta(pass);
      if (!meta.serial) {
        throw new Error(`pass ${pass.id} has no vendor serial — issue it before updating`);
      }
      const spec = specFor(pass, meta.branding, {
        phase: payload.phase,
        rag: payload.rag,
        statusText: payload.text,
        nextMilestone: meta.nextMilestone,
        lastDeliverable: meta.lastDeliverable,
        lastUpdatedISO: new Date().toISOString(),
        link: payload.link,
      });
      await ww(`/api/passes/${meta.serial}`, "PUT", toWWBody(spec));
    },
  };
}
