// Billing + email — the Phase 3 monetization seams.
//
// Tiers enforce at pass issuance. Stripe is integrated without the SDK:
// webhook signatures verified manually (HMAC-SHA256 over `${t}.${payload}`),
// checkout sessions created via a form-encoded POST. Without STRIPE_SECRET_KEY
// everything degrades to free tier + manual tier setting.
//
// Email: one interface, a Resend adapter (fetch), console fallback for dev.

import { createHmac, timingSafeEqual } from "node:crypto";

// ── Tiers ────────────────────────────────────────────────────

export type Tier = "free" | "solo" | "studio" | "agency";

export const TIER_LIMITS: Record<Tier, number> = { free: 1, solo: 5, studio: 25, agency: 75 };
export const TIER_WHITELABEL: Record<Tier, boolean> = { free: false, solo: false, studio: false, agency: true };

export function canIssuePass(tier: Tier, activeCount: number): { ok: true } | { ok: false; error: string } {
  const limit = TIER_LIMITS[tier];
  if (activeCount >= limit) {
    return { ok: false, error: `Your ${tier} plan includes ${limit} active pass${limit === 1 ? "" : "es"}. Upgrade to issue more.` };
  }
  return { ok: true };
}

// ── Stripe webhook verification (no SDK) ─────────────────────
// Stripe-Signature: t=1699999999,v1=hex[,v1=hex...]
// signed_payload = `${t}.${rawBody}`; HMAC-SHA256 with the endpoint secret.

export function verifyStripeSignature(args: {
  rawBody: string; header: string | undefined; endpointSecret: string;
  toleranceSec?: number; now?: Date;
}): boolean {
  const { rawBody, header, endpointSecret } = args;
  if (!header || !endpointSecret) return false;
  const parts = Object.create(null) as Record<string, string[]>;
  for (const kv of header.split(",")) {
    const [k, v] = kv.split("=", 2);
    if (!k || !v) continue;
    (parts[k.trim()] ??= []).push(v.trim());
  }
  const t = parts["t"]?.[0];
  const sigs = parts["v1"] ?? [];
  if (!t || sigs.length === 0) return false;
  const tolerance = args.toleranceSec ?? 300;
  const nowSec = Math.floor((args.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSec - Number(t)) > tolerance) return false;
  const expected = createHmac("sha256", endpointSecret).update(`${t}.${rawBody}`).digest("hex");
  const exp = Buffer.from(expected);
  return sigs.some((s) => {
    const b = Buffer.from(s);
    return b.length === exp.length && timingSafeEqual(b, exp);
  });
}

/** Map a Stripe event to a tier change. priceToTier comes from env, e.g.
 *  STRIPE_PRICE_SOLO=price_x → { price_x: "solo" }. Returns null if the
 *  event isn't tier-relevant. */
export function tierChangeFromEvent(
  event: { type: string; data: { object: Record<string, unknown> } },
  priceToTier: Record<string, Tier>,
): { accountId: string; tier: Tier; stripeCustomerId?: string } | null {
  const obj = event.data.object as Record<string, any>;
  if (event.type === "checkout.session.completed") {
    const accountId = obj.client_reference_id;
    const tier = priceToTier[obj.metadata?.price_id ?? ""] ?? null;
    if (accountId && tier) return { accountId, tier, stripeCustomerId: obj.customer };
    return null;
  }
  if (event.type === "customer.subscription.updated") {
    const accountId = obj.metadata?.account_id;
    const priceId = obj.items?.data?.[0]?.price?.id;
    const tier = priceId ? priceToTier[priceId] : undefined;
    if (accountId && tier && obj.status === "active") return { accountId, tier };
    return null;
  }
  if (event.type === "customer.subscription.deleted") {
    const accountId = obj.metadata?.account_id;
    if (accountId) return { accountId, tier: "free" };
    return null;
  }
  return null;
}

/** Create a Stripe Checkout session (form-encoded POST, no SDK). */
export async function createCheckoutSession(args: {
  secretKey: string; priceId: string; accountId: string; accountEmail: string;
  successUrl: string; cancelUrl: string; fetchImpl?: typeof fetch;
}): Promise<{ url: string }> {
  const body = new URLSearchParams({
    mode: "subscription",
    "line_items[0][price]": args.priceId,
    "line_items[0][quantity]": "1",
    client_reference_id: args.accountId,
    customer_email: args.accountEmail,
    "metadata[price_id]": args.priceId,
    "subscription_data[metadata][account_id]": args.accountId,
    success_url: args.successUrl,
    cancel_url: args.cancelUrl,
  });
  const res = await (args.fetchImpl ?? fetch)("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${args.secretKey}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`stripe checkout: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { url: string };
  return { url: data.url };
}

export function priceToTierFromEnv(env = process.env): Record<string, Tier> {
  const map: Record<string, Tier> = {};
  for (const tier of ["solo", "studio", "agency"] as Tier[]) {
    const price = env[`STRIPE_PRICE_${tier.toUpperCase()}`];
    if (price) map[price] = tier;
  }
  return map;
}

// ── Email ────────────────────────────────────────────────────

export interface EmailSender {
  send(args: { to: string; subject: string; text: string }): Promise<void>;
}

export function createResendSender(apiKey: string, from: string, fetchImpl: typeof fetch = fetch): EmailSender {
  return {
    async send({ to, subject, text }) {
      const res = await fetchImpl("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ from, to, subject, text }),
      });
      if (!res.ok) throw new Error(`resend: ${res.status} ${await res.text()}`);
    },
  };
}

export const consoleEmailSender: EmailSender = {
  async send({ to, subject, text }) {
    console.log(`[email→${to}] ${subject}\n${text}`);
  },
};
