// Pass templates — the visual design as code. Two templates, one per profile;
// only client logo, color, and field values vary at issuance.
//
// Design principles (locked):
//  - Status is the hero, brand is the whisper: phase in large type,
//    client logo small, agency as logo text. Reads as "my project's
//    boarding pass", never as marketing.
//  - client-delivery: one consistent premium brand color per client,
//    NO RAG color — clients get phrased status, not red paint.
//  - internal-program: background shifts with RAG (calm neutral green,
//    amber, red — only when true).
//  - Dark backgrounds, light text: screenshots premium.
//  - Secondary fields: Next milestone + Last updated (freshness signal).
//  - Back of pass: the tokenized primary link with phase-aware label.
//  - changeMessage carries the formatted client-safe sentence to the
//    Apple lock screen verbatim.

import type { Pass, Profile, RagStatus } from "./types.js";
import type { ResolvedLink } from "./pipeline.js";

// ── Palette ──────────────────────────────────────────────────

const NEUTRAL_DARK = "#141826";   // near-black blue — premium default
const TEXT_LIGHT = "#F5F6FA";
const LABEL_MUTED = "#8A91A8";

const RAG_BG: Record<RagStatus, string> = {
  green: "#15201C",  // calm dark green-neutral — does not scream "fine"
  yellow: "#2A2113", // deep amber
  red: "#2A1416",    // deep red
};

// ── Branding supplied per client/account at issuance ─────────

export interface PassBranding {
  /** Client (or program) display name — top of pass. */
  title: string;
  /** Agency / operator name — logo text (the whisper). */
  operatorName: string;
  logoUrl?: string;
  stripImageUrl?: string;
  /** client-delivery only: the one premium brand color. */
  brandColor?: string;
  /** Agency tier: operator's name replaces the StatusPass wordmark. */
  whiteLabel?: boolean;
}

export interface PassContent {
  phase: string;
  rag: RagStatus | null;
  statusText: string;           // the formatted client-safe sentence
  nextMilestone?: string;
  lastDeliverable?: string;     // newest shelf item title, e.g. "Twilio account created"
  lastUpdatedISO: string;
  link: ResolvedLink | null;    // also rendered as the scannable QR
}

// Status line vocabulary (the "ON TRACK ✅" pattern from the field-tested pass).
// Client passes stay calm; internal passes can escalate.
function statusLine(profile: Profile, rag: RagStatus | null): string {
  if (profile === "client-delivery") {
    if (rag === "red") return "NEEDS A DECISION";
    if (rag === "yellow") return "IN PROGRESS";
    return "ON TRACK \u2705";
  }
  if (rag === "red") return "BLOCKED \u26D4";
  if (rag === "yellow") return "AT RISK \u26A0\uFE0F";
  return "ON TRACK \u2705";
}

/** % complete derived from position in the profile's phase order — free
 *  progress signal, zero operator effort. */
export function progressPct(profile: Profile, phase: string, phaseOrder: string[]): number {
  const i = phaseOrder.indexOf(phase);
  if (i <= 0 || phaseOrder.length < 2) return i === -1 ? 0 : Math.round((i / (phaseOrder.length - 1)) * 100);
  return Math.round((i / (phaseOrder.length - 1)) * 100);
}

// ── WalletWallet pass spec shape ─────────────────────────────
// Verify field names against walletwallet.dev/docs once keyed up;
// isolated here so corrections touch one file.

export interface WalletWalletPassSpec {
  description: string;
  organizationName: string;
  logoText: string;             // "StatusPass" top-left
  backgroundColor: string;
  foregroundColor: string;
  labelColor: string;
  logoUrl?: string;
  thumbnailUrl?: string;        // client logo, right side (field-tested layout)
  stripImageUrl?: string;
  headerFields: WWField[];
  primaryFields: WWField[];
  secondaryFields: WWField[];
  auxiliaryFields: WWField[];
  backFields: WWField[];
  /** Scannable QR on the pass face → the current link / demo shelf. */
  barcode?: { format: "PKBarcodeFormatQR"; message: string; messageEncoding: "iso-8859-1" };
}

interface WWField {
  key: string;
  label: string;
  value: string;
  changeMessage?: string; // "%@" is replaced by the new value on the lock screen
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

// ── The two templates ────────────────────────────────────────

export function buildPassSpec(
  profile: Profile,
  branding: PassBranding,
  content: PassContent,
  phaseOrder: string[] = [],
): WalletWalletPassSpec {
  const isClient = profile === "client-delivery";

  // Field-tested layout: steady brand color for clients (teal reads calm and
  // premium); internal passes shift with RAG.
  const backgroundColor = isClient
    ? branding.brandColor ?? "#1B212E"
    : content.rag ? RAG_BG[content.rag] : NEUTRAL_DARK;

  const pct = phaseOrder.length >= 2 ? progressPct(profile, content.phase, phaseOrder) : null;

  const secondaryFields: WWField[] = [
    {
      key: "status", label: "STATUS", value: statusLine(profile, content.rag),
      changeMessage: undefined,
    },
  ];
  if (pct !== null) {
    secondaryFields.push({ key: "progress", label: "PROGRESS", value: `${pct}% COMPLETED` });
  }

  const auxiliaryFields: WWField[] = [];
  if (content.lastDeliverable) {
    auxiliaryFields.push({ key: "lastDeliverable", label: "LAST DELIVERABLE", value: content.lastDeliverable.toUpperCase() });
  } else if (content.nextMilestone) {
    auxiliaryFields.push({ key: "next", label: "NEXT MILESTONE", value: content.nextMilestone.toUpperCase() });
  }
  auxiliaryFields.push({ key: "updated", label: "LAST UPDATED", value: fmtDate(content.lastUpdatedISO) });

  const backFields: WWField[] = [
    // changeMessage must contain %@ (Apple replaces it with the NEW value).
    // This field's value IS the client-safe sentence, so when it changes,
    // the sentence itself is the lock-screen banner. This is the product.
    { key: "statusDetail", label: "Latest update", value: content.statusText, changeMessage: "%@" },
  ];
  if (content.link) {
    backFields.push({ key: "primaryLink", label: content.link.label, value: content.link.url });
  }

  return {
    description: `${branding.title} — project status`,
    organizationName: branding.operatorName,
    logoText: branding.whiteLabel ? branding.operatorName : "StatusPass",
    backgroundColor,
    foregroundColor: TEXT_LIGHT,
    labelColor: isClient ? "#EAF2F1" : LABEL_MUTED,
    logoUrl: branding.logoUrl,
    thumbnailUrl: branding.logoUrl,      // client logo rides right of the primary field
    stripImageUrl: branding.stripImageUrl,
    headerFields: [
      { key: "project", label: isClient ? "PROJECT" : "PROGRAM", value: branding.title },
    ],
    primaryFields: [
      // The big text: what's being worked on right now (feature/phase).
      { key: "phase", label: isClient ? "CURRENT FOCUS" : "PHASE", value: content.phase.toUpperCase() },
    ],
    secondaryFields,
    auxiliaryFields,
    backFields,
    // The QR on the pass face → the same context-aware link (demo shelf,
    // preview, decision doc). Scannable in person or from a screenshot.
    barcode: content.link
      ? { format: "PKBarcodeFormatQR", message: content.link.url, messageEncoding: "iso-8859-1" }
      : undefined,
  };
}
