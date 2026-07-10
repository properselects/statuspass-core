// app.ts — composition root. Wires stores, link resolver, model client,
// delivery adapter, Trello webhook, token redemption, and the cadence timer
// into one bootable server. Everything external stays behind an interface.

import { createServer } from "node:http";
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
    if (req.method === "GET" && url.pathname.startsWith("/g/")) {
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
