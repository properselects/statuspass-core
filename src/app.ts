// app.ts — composition root. Wires stores, link resolver, model client,
// delivery adapter, Trello webhook, token redemption, and the cadence timer
// into one bootable server. Everything external stays behind an interface.

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { ModelClient, ModelRouting, Pass, RagStatus } from "./types.js";
import type { PipelineDeps } from "./pipeline.js";
import type { ResolvedLink } from "./pipeline.js";
import { InMemoryStores, runCadenceJob, type Stores } from "./cadence.js";
import { makeResolvePrimaryLink, redeemLinkToken } from "./links.js";
import {
  InMemoryBrandingStore, handleAssetUpload, handleBrandingSubmit,
  redeemBrandingToken, renderIntakePage, type BrandingStore,
} from "./branding.js";
import { redeemGalleryToken, renderGalleryPage } from "./gallery.js";
import { handleTrelloWebhook } from "./trello/webhook.js";
import { handleJiraWebhook } from "./jira/webhook.js";
import { handleConsoleApi } from "./console/api.js";
import { BODY_LIMITS, BodyTooLarge, RateLimiter, clientIp, logRequest, readBody } from "./http-guards.js";
import { EMAIL_RE, hashPassword, mintSessionToken, renderLoginPage, renderSignupPage,
         sessionFromCookie, verifyPassword } from "./auth.js";
import { consoleEmailSender, createResendSender, priceToTierFromEnv, tierChangeFromEvent,
         verifyStripeSignature, type EmailSender, type Tier } from "./billing.js";
import { randomUUID } from "node:crypto";
import { renderConsolePage } from "./console/ui.js";
import { LOGO_PNG_B64 } from "./logo.js";
import { createAnthropicClient, DEFAULT_ROUTING } from "./model/anthropic.js";

// ── Pass delivery adapter (the BUY seam — AddToWallet-style vendor) ──

export interface PassDeliveryAdapter {
  /** Push the new state to the wallet pass via the vendor. */
  pushUpdate(pass: Pass, payload: {
    phase: string; rag: RagStatus | null; text: string; link: ResolvedLink | null;
  }): Promise<void>;
  /** Optional: first-time vendor issuance (WalletWallet adapter provides it). */
  issuePass?(pass: Pass, content: {
    phase: string; rag: RagStatus | null; statusText: string;
    nextMilestone?: string; lastUpdatedISO: string; link: null;
  }): Promise<{ serial: string; addUrl: string; googleSaveUrl: string }>;
}

/** Dev adapter: logs instead of calling a vendor. Swap for the real one. */
export const consoleDeliveryAdapter: PassDeliveryAdapter = {
  async pushUpdate(pass, payload) {
    console.log(`[deliver] pass=${pass.id} phase=${payload.phase} rag=${payload.rag ?? "-"}`);
    console.log(`          "${payload.text}"${payload.link ? ` → [${payload.link.label}] ${payload.link.url}` : ""}`);
  },
};

// ── Config from env ──────────────────────────────────────────

export interface AppConfig {
  port: number;
  publicBaseUrl: string;       // e.g. https://statuspass.ai
  trelloApiSecret: string;
  jiraWebhookSecret: string;
  linkTokenSecret: string;
  anthropicApiKey?: string;    // absent → dev echo model
  routing: ModelRouting;
  cadenceIntervalMs: number;
  consoleToken: string;
  defaultAccountId: string;
  stripeWebhookSecret: string;
  emailFrom: string;
}

export function configFromEnv(env = process.env): AppConfig {
  return {
    port: Number(env.PORT ?? 8080),
    publicBaseUrl: env.STATUSPASS_PUBLIC_URL ?? `http://localhost:${env.PORT ?? 8080}`,
    trelloApiSecret: env.TRELLO_API_SECRET ?? "",
    jiraWebhookSecret: env.JIRA_WEBHOOK_SECRET ?? "",
    linkTokenSecret: env.STATUSPASS_LINK_SECRET ?? "",
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    routing: DEFAULT_ROUTING,
    cadenceIntervalMs: Number(env.STATUSPASS_CADENCE_INTERVAL_MS ?? 3_600_000),
    consoleToken: env.STATUSPASS_CONSOLE_TOKEN ?? "",
    defaultAccountId: env.STATUSPASS_DEFAULT_ACCOUNT ?? "default",
    stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET ?? "",
    emailFrom: env.STATUSPASS_EMAIL_FROM ?? "StatusPass <updates@statuspass.ai>",
  };
}

/** Dev model when no API key: deterministic echo that satisfies the schema. */
export const devEchoModel: ModelClient = {
  async complete({ user }) {
    const phase = /phase: (.+)/.exec(user)?.[1]?.trim() ?? "Update";
    const rag = /rag: (green|yellow|red)/.exec(user)?.[1] ?? null;
    return JSON.stringify({ text: `Update: now in ${phase}.`, phase, rag });
  },
};

// ── Wiring ───────────────────────────────────────────────────

export function buildPipelineDeps(args: {
  stores: Stores;
  delivery: PassDeliveryAdapter;
  config: AppConfig;
  brandingStore?: BrandingStore;
  notifyOperator?: (passId: string, message: string) => Promise<void>;
}): PipelineDeps {
  const { stores, delivery, config, brandingStore } = args;
  const resolvePrimaryLink = makeResolvePrimaryLink({
    tokenSecret: config.linkTokenSecret,
    redeemBaseUrl: `${config.publicBaseUrl}/l`,
    galleryBaseUrl: `${config.publicBaseUrl}/g`,
    hasDeliverables: brandingStore
      ? async (passId) => (await brandingStore.listDeliverables(passId)).length > 0
      : undefined,
  });
  const notifyOperator = args.notifyOperator ?? (async (id, msg) => console.log(`[operator] ${id}: ${msg}`));

  return {
    getPassForBoardCard: (e) => stores.getPassForBoardCard(e.boardId, e.cardId),
    getAccount: (id) => stores.getAccount(id),
    getProfileConfig: (id, p) => stores.getProfileConfig(id, p),
    resolvePrimaryLink,
    deliverPassUpdate: async (pass, payload) => {
      await delivery.pushUpdate(pass, payload);
      pass.currentPhase = payload.phase;
      pass.currentRag = payload.rag ?? undefined;
      pass.primaryLink = payload.link ?? pass.primaryLink;
      await stores.savePass(pass);
    },
    touchPass: async (pass, now) => {
      pass.lastUpdatedAt = now.toISOString();
      pass.lastPushAt = now.toISOString();
      await stores.savePass(pass);
    },
    notifyOperator,
  };
}

const _dir = dirname(fileURLToPath(import.meta.url));
let landingHtml = "";
try { landingHtml = readFileSync(join(_dir, "../site/index.html"), "utf8"); } catch { landingHtml = ""; }

// Demo pass phase table (used by /api/demo/move + /api/demo/notify)
const DEMO_PHASES = {
  "0": { phase: "DISCOVERY",  pct: "0%",   status: "On Track",    msg: "Kickoff done. Discovery brief is on your shelf — tap the QR to review.",         deliverable: "Kickoff notes",  nextMilestone: "Discovery review" },
  "1": { phase: "DESIGN",     pct: "25%",  status: "On Track",    msg: "Moodboard approved. First concepts drop Wednesday — I'll ping when they land.",  deliverable: "Moodboard",      nextMilestone: "v1 concepts" },
  "2": { phase: "BUILD",      pct: "50%",  status: "On Track",    msg: "Staging is live — tap the QR, then Sprint Preview. Feedback by Fri helps most.", deliverable: "Staging live",   nextMilestone: "First internal QA" },
  "3": { phase: "IN REVIEW",  pct: "75%",  status: "In Progress", msg: "Homepage v3 is up. Waiting on final copy from you — target ship next Tuesday.",  deliverable: "v3 shipped",     nextMilestone: "Final copy sign-off" },
  "4": { phase: "DELIVERED",  pct: "100%", status: "Complete",    msg: "Delivered. All assets handed off. Demo shelf has every Loom, mock, and preview.", deliverable: "Handed off",     nextMilestone: "30-day retro" },
} as const;
function getDemoPhase(idx: string) { return (DEMO_PHASES as any)[idx] ?? DEMO_PHASES["0"]; }

export function startServer(overrides: Partial<{
  config: AppConfig; stores: Stores; delivery: PassDeliveryAdapter; model: ModelClient;
  brandingStore: BrandingStore; email: EmailSender;
}> = {}) {
  const config = overrides.config ?? configFromEnv();
  if (!config.linkTokenSecret) throw new Error("STATUSPASS_LINK_SECRET is required");
  if (!config.trelloApiSecret) console.warn("[warn] TRELLO_API_SECRET unset — webhook will reject all posts");

  const stores = overrides.stores ?? new InMemoryStores();
  const brandingStore = overrides.brandingStore ?? new InMemoryBrandingStore();
  const delivery = overrides.delivery ?? consoleDeliveryAdapter;
  const client = overrides.model ?? (config.anthropicApiKey
    ? createAnthropicClient(config.anthropicApiKey)
    : (console.warn("[warn] ANTHROPIC_API_KEY unset — using dev echo model"), devEchoModel));

  const email = overrides.email ?? (process.env.RESEND_API_KEY
    ? createResendSender(process.env.RESEND_API_KEY, config.emailFrom)
    : (console.warn("[warn] RESEND_API_KEY unset — operator emails log to console"), consoleEmailSender));
  // Operator nudges become real email: pass → account → email (console fallback).
  const notifyOperator = async (passId: string, message: string) => {
    try {
      const pass = (await stores.listActivePasses()).find((p) => p.id === passId);
      const account = pass ? await stores.getAccount(pass.accountId) : null;
      if (account?.email) {
        await email.send({ to: account.email, subject: `StatusPass: ${pass?.recipientLabel ?? "a pass"} needs you`, text: message });
        return;
      }
    } catch (e) { console.error("[notify]", e); }
    console.log(`[operator] ${passId}: ${message}`);
  };
  const deps = buildPipelineDeps({ stores, delivery, config, brandingStore, notifyOperator });
  const model = { client, routing: config.routing };
  if (!config.consoleToken) console.warn("[warn] STATUSPASS_CONSOLE_TOKEN unset — console API will reject all requests");
  // Ensure the default account exists so the console works on first boot.
  // Tracked promise: every request awaits it, so nothing races the bootstrap.
  const ready = stores.getAccount(config.defaultAccountId).then(() => undefined).catch(() =>
    stores.saveAccount({ id: config.defaultAccountId, name: "Default", defaults: {}, internalNames: [] }),
  );
  const webhookConfig = {
    callbackUrl: `${config.publicBaseUrl}/webhooks/trello`,
    apiSecret: config.trelloApiSecret,
  };

  // Public unauthenticated routes get tight limits; webhooks looser
  // (board vendors retry, and they're already secret/signature-gated).
  const publicLimiter = new RateLimiter(30, 60_000);   // 30/min per IP
  const webhookLimiter = new RateLimiter(300, 60_000); // 300/min per IP
  const limiterSweep = setInterval(() => { publicLimiter.sweep(); webhookLimiter.sweep(); }, 300_000);
  limiterSweep.unref();

  const server = createServer((req, res) => {
    const startedAt = Date.now();
    const ip = clientIp(req);
    const url = new URL(req.url ?? "/", config.publicBaseUrl);
    const end = (status: number, headers: Record<string, string>, body: string | Buffer) => {
      res.writeHead(status, headers).end(body);
      logRequest(req.method ?? "GET", url.pathname, status, startedAt, ip);
    };

    handle().catch((e) => {
      if (e instanceof BodyTooLarge) end(413, { "content-type": "text/plain" }, "Request too large.");
      else { console.error("[server]", e); end(500, { "content-type": "text/plain" }, "Something went wrong."); }
    });

    async function handle() {
      await ready;
      const isPublic = url.pathname.startsWith("/l/") || url.pathname.startsWith("/brand/") ||
        url.pathname.startsWith("/assets/") || url.pathname.startsWith("/g/");
      const isWebhook = url.pathname.startsWith("/webhooks/");
      if (isPublic && !publicLimiter.allow(ip + ":pub")) {
        end(429, { "content-type": "text/plain", "retry-after": "60" }, "Too many requests — try again in a minute.");
        return;
      }
      if (isWebhook && !webhookLimiter.allow(ip + ":wh")) {
        end(429, { "content-type": "text/plain", "retry-after": "60" }, "rate limited");
        return;
      }

    // Token redemption: GET /l/:token → 302
    if (req.method === "GET" && url.pathname.startsWith("/l/")) {
      const result = redeemLinkToken(url.pathname.slice(3), config.linkTokenSecret);
      if (result.ok) end(302, { location: result.url }, "");
      else end(result.reason === "expired" ? 410 : 404, { "content-type": "text/plain" },
        result.reason === "expired" ? "This link has expired. Ask for a fresh update." : "Not found.");
      return;
    }

    // Deliverables gallery: GET /g/:token → hosted page
    // NOTE: /g/demo is intercepted below (public demo gallery) — the token route ignores it
    if (req.method === "GET" && url.pathname.startsWith("/g/") && url.pathname !== "/g/demo") {
      const result = redeemGalleryToken(url.pathname.slice(3), config.linkTokenSecret);
      if (!result.ok) {
        end(result.reason === "expired" ? 410 : 404, { "content-type": "text/plain" },
          result.reason === "expired" ? "This link has expired. Ask for a fresh update." : "Not found.");
        return;
      }
      const [branding, items] = await Promise.all([
        brandingStore.getBranding(result.passId),
        brandingStore.listDeliverables(result.passId),
      ]);
      end(200, { "content-type": "text/html; charset=utf-8" },
        renderGalleryPage(branding, items, `${config.publicBaseUrl}/assets`));
      return;
    }

    // Trello webhook
    if (url.pathname === "/webhooks/trello") {
      const raw = (await readBody(req, BODY_LIMITS.json)).toString();
      const out = await handleTrelloWebhook(
        { method: req.method ?? "POST", rawBody: raw, headers: req.headers as Record<string, string> },
        webhookConfig, deps, model,
      );
      end(out.status, { "content-type": "text/plain" }, out.body);
      return;
    }

    // Branding intake: GET /brand/:token → page; POST /brand/:token → save
    // fields; POST /brand/:token/upload?slot=logo|strip → image bytes.
    if (url.pathname.startsWith("/brand/")) {
      const rest = url.pathname.slice("/brand/".length);
      const [token, sub] = rest.split("/", 2);
      const redeemed = redeemBrandingToken(token ?? "", config.linkTokenSecret);
      if (!redeemed.ok) {
        end(redeemed.reason === "expired" ? 410 : 404, { "content-type": "text/plain" },
          redeemed.reason === "expired" ? "This setup link has expired — ask for a fresh one." : "Not found.");
        return;
      }
      if (req.method === "GET" && !sub) {
        const existing = await brandingStore.getBranding(redeemed.passId);
        end(200, { "content-type": "text/html; charset=utf-8" }, renderIntakePage(token, existing));
        return;
      }
      if (req.method === "POST" && sub === "upload") {
        const slot = url.searchParams.get("slot") === "strip" ? "strip" as const : "logo" as const;
        const bytes = await readBody(req, BODY_LIMITS.upload);
        const result = await handleAssetUpload(
          brandingStore, redeemed.passId, slot, req.headers["content-type"], bytes,
        );
        end(result.ok ? 200 : 400, { "content-type": "application/json" }, JSON.stringify(result));
        return;
      }
      if (req.method === "POST" && !sub) {
        const raw = (await readBody(req, BODY_LIMITS.json)).toString();
        {
          let fields: { title?: string; brandColor?: string } = {};
          try { fields = JSON.parse(raw); } catch { /* empty body ok */ }
          const result = await handleBrandingSubmit(brandingStore, redeemed.passId, fields);
          if (!result.ok) {
            end(400, { "content-type": "application/json" }, JSON.stringify(result));
            return;
          }
          // Auto-issue: branding done → vendor pass exists → the SAME page
          // shows Add to Wallet. The operator sent one link and is finished.
          let addUrl: string | undefined;
          try {
            const pass = (await stores.listActivePasses()).find((p) => p.id === redeemed.passId);
            if (pass) {
              if (pass.addUrl) {
                addUrl = pass.addUrl;
              } else if (delivery.issuePass) {
                const issued = await delivery.issuePass(pass, {
                  phase: pass.currentPhase, rag: pass.currentRag ?? null,
                  statusText: "Your project pass is ready.",
                  lastUpdatedISO: new Date().toISOString(), link: null,
                });
                pass.addUrl = issued.addUrl;
                await stores.savePass(pass);
                addUrl = issued.addUrl;
              }
            }
          } catch (e) {
            console.error("[auto-issue]", e); // branding still succeeded; operator can issue manually
          }
          end(200, { "content-type": "application/json" }, JSON.stringify({ ok: true, addUrl }));
        }
        return;
      }
      end(405, {}, "");
      return;
    }

    // Hosted branding assets for the vendor spec's logoUrl/stripImageUrl
    if (req.method === "GET" && url.pathname.startsWith("/assets/")) {
      const asset = await brandingStore.getAsset(url.pathname.slice("/assets/".length));
      if (!asset) { end(404, {}, "not found"); return; }
      end(200, {
        "content-type": asset.contentType,
        "cache-control": "public, max-age=86400",
      }, asset.bytes);
      return;
    }

    // Jira webhook: POST /webhooks/jira/{secret}
    if (url.pathname.startsWith("/webhooks/jira/")) {
      const raw = (await readBody(req, BODY_LIMITS.json)).toString();
      const out = await handleJiraWebhook(
        { method: req.method ?? "POST", rawBody: raw,
          pathSecret: url.pathname.slice("/webhooks/jira/".length),
          headerSecret: req.headers["x-statuspass-secret"] as string | undefined },
        { webhookSecret: config.jiraWebhookSecret }, deps, model,
      );
      end(out.status, { "content-type": "text/plain" }, out.body);
      return;
    }

    // ── Auth (multi-tenant self-serve) ──
    if (url.pathname === "/signup" || url.pathname === "/login") {
      const isSignup = url.pathname === "/signup";
      if (req.method === "GET") {
        end(200, { "content-type": "text/html; charset=utf-8" },
          isSignup ? renderSignupPage() : renderLoginPage());
        return;
      }
      if (req.method === "POST") {
        const raw = (await readBody(req, BODY_LIMITS.json)).toString();
        const form = new URLSearchParams(raw);
        const emailAddr = (form.get("email") ?? "").trim().toLowerCase();
        const password = form.get("password") ?? "";
        const fail = (msg: string) => end(400, { "content-type": "text/html; charset=utf-8" },
          isSignup ? renderSignupPage(msg) : renderLoginPage(msg));
        if (!EMAIL_RE.test(emailAddr) || password.length < 8) { fail("Check your email and use 8+ characters."); return; }
        let accountId: string;
        if (isSignup) {
          if (await stores.getAccountByEmail(emailAddr)) { fail("That email already has an account — log in instead."); return; }
          accountId = randomUUID();
          await stores.saveAccount({
            id: accountId, name: (form.get("name") ?? "Operator").slice(0, 60),
            defaults: {}, internalNames: [], email: emailAddr,
            passwordHash: hashPassword(password), tier: "free",
          });
          email.send({ to: emailAddr, subject: "Welcome to StatusPass",
            text: "Your console is ready. First move: create a demo pass for yourself and feel your own phone buzz.\n\n" +
                  `${config.publicBaseUrl}/console` }).catch(() => {});
        } else {
          const account = await stores.getAccountByEmail(emailAddr);
          if (!account?.passwordHash || !verifyPassword(password, account.passwordHash)) {
            fail("Email or password didn't match."); return;
          }
          accountId = account.id;
        }
        const token = mintSessionToken(accountId, config.linkTokenSecret);
        res.writeHead(302, {
          location: "/console",
          "set-cookie": `sp_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}`,
        }).end();
        logRequest(req.method, url.pathname, 302, startedAt, ip);
        return;
      }
      end(405, {}, ""); return;
    }
    if (url.pathname === "/logout") {
      res.writeHead(302, { location: "/login", "set-cookie": "sp_session=; Path=/; Max-Age=0" }).end();
      logRequest(req.method ?? "GET", url.pathname, 302, startedAt, ip);
      return;
    }

    // ── Stripe webhook: tier changes on subscription events ──
    if (url.pathname === "/webhooks/stripe" && req.method === "POST") {
      const raw = (await readBody(req, BODY_LIMITS.json)).toString();
      const ok = verifyStripeSignature({
        rawBody: raw, header: req.headers["stripe-signature"] as string | undefined,
        endpointSecret: config.stripeWebhookSecret,
      });
      if (!ok) { end(401, {}, "bad signature"); return; }
      try {
        const event = JSON.parse(raw);
        const change = tierChangeFromEvent(event, priceToTierFromEnv());
        if (change) {
          const account = await stores.getAccount(change.accountId);
          account.tier = change.tier as Tier;
          if (change.stripeCustomerId) account.stripeCustomerId = change.stripeCustomerId;
          await stores.saveAccount(account);
          console.log(`[billing] ${change.accountId} → ${change.tier}`);
        }
        end(200, {}, "ok");
      } catch { end(400, {}, "bad event"); }
      return;
    }

    // ── Public demo endpoints (no auth needed) ──
    const demoSerial = process.env.DEMO_PASS_SERIAL ?? "";
    const demoShareUrl = process.env.DEMO_PASS_SHARE_URL ?? "";
    const wwKey = process.env.WALLETWALLET_API_KEY ?? "";

    if (req.method === "GET" && url.pathname === "/g/demo") {
      const deliverables = [
        { title: "Sprint 6 demo", host: "loom.com", url: "https://www.loom.com/share/demo-sprint-6", when: "Jul 8" },
        { title: "Staging preview", host: "vercel.app", url: "https://homepage-redesign-demo.vercel.app", when: "Jul 5" },
        { title: "Homepage v3 mockups", host: "figma.com", url: "https://www.figma.com/design/demo-homepage-v3", when: "Jul 3" },
        { title: "Discovery brief", host: "notion.so", url: "https://www.notion.so/demo-discovery-brief", when: "Jun 27" },
        { title: "Kickoff recording", host: "loom.com", url: "https://www.loom.com/share/demo-kickoff", when: "Jun 21" },
      ];
      const rows = deliverables.map(d =>
        `<a class="card link" href="${d.url}" rel="noopener" target="_blank">` +
        `<span class="t">${d.title}<span class="when">${d.when}</span></span>` +
        `<span class="u">${d.host} →</span></a>`
      ).join("\n");
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>StatusPass demo — Deliverables</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0B0E16;color:#F2F4F9;margin:0;padding:24px;display:flex;justify-content:center;min-height:100vh}
  main{max-width:520px;width:100%}
  .band{height:6px;border-radius:6px;background:#1B212E;margin-bottom:18px}
  .kicker{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.7rem;letter-spacing:.14em;color:#C9A96A;text-transform:uppercase;margin-bottom:8px}
  h1{font-size:1.35rem;margin:0 0 4px;font-weight:700}
  p.sub{color:#8A93AB;margin:0 0 22px;font-size:.9rem;line-height:1.5}
  .grid{display:grid;grid-template-columns:1fr;gap:12px}
  .card.link{display:flex;justify-content:space-between;align-items:center;padding:16px;text-decoration:none;color:#F2F4F9;
             background:#151A28;border:1px solid #262D40;border-radius:14px;transition:border-color .15s,transform .15s}
  .card.link:hover{border-color:#C9A96A;transform:translateY(-1px)}
  .card .t{font-size:.98rem;font-weight:600}
  .card .u{color:#8A93AB;font-size:.85rem;white-space:nowrap;margin-left:12px;font-family:ui-monospace,monospace}
  .when{display:block;color:#5d6478;font-size:.72rem;margin-top:3px;font-family:ui-monospace,monospace}
  footer{margin-top:32px;font-size:.72rem;color:#5d6478;text-align:center;letter-spacing:.06em;font-family:ui-monospace,monospace}
  footer a{color:#8A93AB;text-decoration:none}
</style></head>
<body><main>
  <div class="band"></div>
  <div class="kicker">Demo project · Deliverables</div>
  <h1>Homepage Redesign</h1>
  <p class="sub">Every demo, preview, and finished deliverable — newest first. This is what your client taps into from the QR code on their wallet pass.</p>
  <div class="grid">${rows}</div>
  <footer>StatusPass demo · <a href="/">visit landing</a></footer>
</main></body></html>`;
      end(200, { "content-type": "text/html; charset=utf-8", "cache-control": "public,max-age=60" }, html);
      return;
    }

    if (req.method === "GET" && url.pathname === "/logo.png") {
      const buf = Buffer.from(LOGO_PNG_B64, "base64");
      end(200, { "content-type": "image/png", "cache-control": "public,max-age=604800" }, buf);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/demo/pass") {
      if (!demoShareUrl) { end(503, { "content-type": "application/json" }, JSON.stringify({ error: "demo not configured" })); return; }
      end(200, { "content-type": "application/json", "cache-control": "public,max-age=86400" },
        JSON.stringify({ shareUrl: demoShareUrl, serial: demoSerial }));
      return;
    }

    // Send a custom notification to the demo pass. Landing-page users type a
    // message; we PUT the pass with that message in the LATEST UPDATE back field
    // (changeMessage triggers the push). Rate limited to prevent abuse.
    if (req.method === "POST" && url.pathname === "/api/demo/notify") {
      if (!demoSerial || !wwKey) { end(503, { "content-type": "application/json" }, JSON.stringify({ error: "demo not configured" })); return; }
      // Very small per-IP rate limit (in-memory; resets on restart)
      const bucket = (globalThis as any).__spDemoNotify ??= new Map<string, number[]>();
      const now = Date.now();
      const stamps = (bucket.get(ip) ?? []).filter((t: number) => now - t < 60_000);
      if (stamps.length >= 3) {
        end(429, { "content-type": "application/json" }, JSON.stringify({ error: "Slow down — max 3 pushes per minute per visitor." }));
        return;
      }
      stamps.push(now); bucket.set(ip, stamps);
      try {
        const body = await readBody(req, BODY_LIMITS.json);
        const parsed = JSON.parse(body.toString());
        const raw = String(parsed.message ?? "").trim();
        if (!raw) { end(400, { "content-type": "application/json" }, JSON.stringify({ error: "message required" })); return; }
        if (raw.length > 140) { end(400, { "content-type": "application/json" }, JSON.stringify({ error: "keep it under 140 characters" })); return; }
        // Basic sanitation — reject obvious abuse patterns
        if (/https?:\/\/(?!statuspass|walletwallet)|<script|javascript:|onerror=/i.test(raw)) {
          end(400, { "content-type": "application/json" }, JSON.stringify({ error: "no external links or scripts, please" }));
          return;
        }
        // Read the CURRENT demo phase so the pass face doesn't get rewritten.
        // Only the invisible "Latest ping" back-field value changes, which is
        // what triggers the lock-screen notification.
        const state = (globalThis as any).__spDemoState ?? { idx: "0" };
        const logoUrl = `${config.publicBaseUrl}/logo.png`;
        const galleryUrl = `${config.publicBaseUrl}/g/demo`;
        const d = getDemoPhase(state.idx);
        // Uniqueness token so consecutive identical messages still notify
        const stamp = new Date().toISOString().slice(11, 19) + " UTC";
        const wwBody = {
          barcodeValue: galleryUrl, barcodeFormat: "QR",
          logoText: "StatusPass", description: "Homepage Redesign — Acme Corp",
          organizationName: "StatusPass",
          headerFields: [{ label: "PROJECT", value: "Homepage Redesign" }],
          // Keep pass face identical — same primary/secondary as current phase
          primaryFields: [{ label: "CURRENT FOCUS", value: d.phase }],
          secondaryFields: [
            { label: "STATUS", value: d.status },
            { label: "PROGRESS", value: d.pct },
            { label: "DELIVERABLE", value: d.deliverable },
          ],
          backFields: [
            // Update this hidden field — value change + changeMessage fires the push
            { label: "Latest ping", value: `${raw} · ${stamp}`, changeMessage: `${raw}\n(%@ — latest ping)` },
            { label: "Next milestone", value: d.nextMilestone },
            { label: "Demo shelf", value: galleryUrl },
            { label: "About this pass", value: "Live StatusPass demo. Anyone can push a message from statuspass-production.up.railway.app to this shared demo pass." },
          ],
          color: "#1B212E",
          logoURL: logoUrl,
          sharingProhibited: false,
        };
        const res = await fetch(`https://api.walletwallet.dev/api/passes/${demoSerial}`, {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: `Bearer ${wwKey}` },
          body: JSON.stringify(wwBody),
        });
        if (!res.ok) { end(502, { "content-type": "application/json" }, JSON.stringify({ error: `WW error ${res.status}` })); return; }
        end(200, { "content-type": "application/json" }, JSON.stringify({ ok: true, sent: raw }));
      } catch (e: any) { end(500, { "content-type": "application/json" }, JSON.stringify({ error: e.message })); }
      return;
    }

    if (req.method === "POST" && url.pathname === "/api/demo/move") {
      if (!demoSerial || !wwKey) { end(503, { "content-type": "application/json" }, JSON.stringify({ error: "demo not configured" })); return; }
      try {
        const body = await readBody(req, BODY_LIMITS.json);
        const parsed = JSON.parse(body.toString());
        const idx = String(parsed.idx ?? "0");
        const d = getDemoPhase(idx);
        // Persist current phase idx so /api/demo/notify preserves the pass face
        (globalThis as any).__spDemoState = { idx };
        const logoUrl = `${config.publicBaseUrl}/logo.png`;
        const galleryUrl = `${config.publicBaseUrl}/g/demo`;
        const wwBody = {
          // QR on the installed pass points to the demo gallery / mini-repo
          barcodeValue: galleryUrl, barcodeFormat: "QR",
          logoText: "StatusPass", description: "Homepage Redesign — Acme Corp",
          organizationName: "StatusPass",
          headerFields: [{ label: "PROJECT", value: "Homepage Redesign" }],
          primaryFields: [{
            label: "CURRENT FOCUS",
            value: d.phase,
            // %@ is required. Put it at the end so the actionable sentence leads.
            // Renders as: "Homepage v3 is up. Waiting on final copy from you… IN REVIEW"
            changeMessage: `${d.msg}\n(now %@)`,
          }],
          secondaryFields: [
            { label: "STATUS", value: d.status },
            { label: "PROGRESS", value: d.pct },
            { label: "DELIVERABLE", value: d.deliverable, changeMessage: "New deliverable: %@" },
          ],
          backFields: [
            { label: "Next milestone", value: d.nextMilestone },
            { label: "Latest update", value: d.msg },
            { label: "Demo shelf", value: galleryUrl },
            { label: "About this pass", value: "Live StatusPass demo. Visit statuspass-production.up.railway.app and drag the kanban card to watch this pass update in real time." },
          ],
          color: "#1B212E",
          logoURL: logoUrl,
          sharingProhibited: false,
        };
        const res = await fetch(`https://api.walletwallet.dev/api/passes/${demoSerial}`, {
          method: "PUT",
          headers: { "content-type": "application/json", authorization: `Bearer ${wwKey}` },
          body: JSON.stringify(wwBody),
        });
        if (!res.ok) { end(502, { "content-type": "application/json" }, JSON.stringify({ error: `WW error ${res.status}` })); return; }
        end(200, { "content-type": "application/json" }, JSON.stringify({ ok: true, phase: d.phase, msg: d.msg }));
      } catch (e: any) { end(500, { "content-type": "application/json" }, JSON.stringify({ error: e.message })); }
      return;
    }

    // Console UI + API
    if (req.method === "GET" && url.pathname === "/console") {
      const session = sessionFromCookie(req.headers.cookie, config.linkTokenSecret);
      const hasLegacyKey = !!url.searchParams.get("key");
      if (!session.ok && !hasLegacyKey && config.consoleToken) {
        res.writeHead(302, { location: "/login" }).end();
        logRequest("GET", url.pathname, 302, startedAt, ip);
        return;
      }
      end(200, { "content-type": "text/html; charset=utf-8" }, renderConsolePage());
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const isUpload = url.pathname.endsWith("/deliverables/upload");
      const raw = await readBody(req, isUpload ? BODY_LIMITS.upload : BODY_LIMITS.json);
      const session = sessionFromCookie(req.headers.cookie, config.linkTokenSecret);
      const out = await handleConsoleApi(
        { method: req.method ?? "GET", path: url.pathname, query: url.searchParams,
          rawBody: raw, contentType: req.headers["content-type"], auth: req.headers.authorization,
          sessionAccountId: session.ok ? session.accountId : undefined },
        { stores, deps, model, brandingStore, config: {
            consoleToken: config.consoleToken, publicBaseUrl: config.publicBaseUrl,
            linkTokenSecret: config.linkTokenSecret, defaultAccountId: config.defaultAccountId } },
      );
      if (out) end(out.status, { "content-type": out.contentType }, out.body);
      else end(404, {}, "not found");
      return;
    }

    if (url.pathname === "/healthz") {
      end(200, {}, "ok");
      return;
    }

    if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) {
      end(200, { "content-type": "text/html; charset=utf-8" }, landingHtml);
      return;
    }
    end(404, {}, "not found");
    } // end handle()
  });

  const cadenceTimer = setInterval(() => {
    runCadenceJob({
      stores,
      deliverPassUpdate: (pass, payload) => delivery.pushUpdate(pass, payload),
      notifyOperator: deps.notifyOperator,
    }).catch((e) => console.error("[cadence]", e));
  }, config.cadenceIntervalMs);
  cadenceTimer.unref();

  server.listen(config.port, () => console.log(`StatusPass listening on :${config.port}`));
  return { server, stores, brandingStore, stop: () => { clearInterval(cadenceTimer); clearInterval(limiterSweep); server.close(); } };
}
