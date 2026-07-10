// Console API — the JSON backend for the pass control panel.
// Guarded by a bearer token (STATUSPASS_CONSOLE_TOKEN). Single-operator MVP.
// Every endpoint manages PASSES, not projects — the console scope rule.

import { randomUUID, timingSafeEqual } from "node:crypto";
import type { Account, BoardEvent, ModelClient, ModelRouting, Pass, Profile } from "../types.js";
import type { PipelineDeps } from "../pipeline.js";
import { handleBoardEvent } from "../pipeline.js";
import type { Stores } from "../cadence.js";
import { SYSTEM_DEFAULTS } from "../defaults.js";
import { resolveRules } from "../merge.js";
import { mintBrandingToken, handleAssetUpload, type BrandingStore } from "../branding.js";
import { mintGalleryToken, newDeliverable, validateLinkDeliverable } from "../gallery.js";
import { canIssuePass } from "../billing.js";

// Console needs two writes beyond the pipeline's Stores.
export interface ConsoleStores extends Stores {
  saveAccount(account: Account): Promise<void>;
  registerCard(boardId: string, cardId: string, passId: string): Promise<void>;
}

export interface ConsoleConfig {
  consoleToken: string;       // legacy single-tenant mode
  publicBaseUrl: string;
  linkTokenSecret: string;
  defaultAccountId: string;
}

export interface ConsoleContext {
  stores: ConsoleStores;
  deps: PipelineDeps;
  model: { client: ModelClient; routing: ModelRouting };
  brandingStore: BrandingStore;
  config: ConsoleConfig;
}

const DAY_MS = 86_400_000;

function authorized(header: string | undefined, token: string): boolean {
  if (!header?.startsWith("Bearer ") || !token) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}

const json = (status: number, body: unknown) => ({
  status, contentType: "application/json", body: JSON.stringify(body),
});

export interface ConsoleResponse { status: number; contentType: string; body: string }

/** Route console API calls. Returns null if the path isn't ours. */
export async function handleConsoleApi(
  req: { method: string; path: string; query: URLSearchParams; rawBody: Buffer;
         contentType: string | undefined; auth: string | undefined;
         /** account resolved from a session cookie by the server; undefined = not logged in */
         sessionAccountId?: string },
  ctx: ConsoleContext,
): Promise<ConsoleResponse | null> {
  if (!req.path.startsWith("/api/")) return null;
  // Auth: a session cookie (multi-tenant) OR the legacy console token
  // (single-tenant design-partner deployments). Session wins when present.
  const accountId = req.sessionAccountId
    ?? (authorized(req.auth, ctx.config.consoleToken) ? ctx.config.defaultAccountId : undefined);
  if (!accountId) return json(401, { error: "Log in or provide the console key." });

  const parse = <T>(fallback: T): T => {
    try { return JSON.parse(req.rawBody.toString("utf8")) as T; } catch { return fallback; }
  };

  // ── GET /api/passes — the list + staleness radar ──
  if (req.method === "GET" && req.path === "/api/passes") {
    const now = Date.now();
    const passes = (await ctx.stores.listPassesForAccount(accountId)).map((p) => ({
      id: p.id, recipientLabel: p.recipientLabel, profile: p.profile,
      currentPhase: p.currentPhase, currentRag: p.currentRag ?? null,
      boardId: p.boardId, lastUpdatedAt: p.lastUpdatedAt,
      quietDays: Math.floor((now - new Date(p.lastUpdatedAt).getTime()) / DAY_MS),
      primaryLink: p.primaryLink ?? null,
    }));
    return json(200, { passes });
  }

  // ── POST /api/passes — issuance: create, index the card, mint branding link ──
  if (req.method === "POST" && req.path === "/api/passes") {
    const body = parse<{ recipientLabel?: string; profile?: Profile; boardId?: string; cardId?: string }>({});
    if (!body.recipientLabel || !body.profile || !body.boardId) {
      return json(400, { error: "recipientLabel, profile, and boardId are required." });
    }
    // Tier enforcement: the value meter is active passes.
    const account = await ctx.stores.getAccount(accountId);
    const active = await ctx.stores.listPassesForAccount(accountId);
    const gate = canIssuePass(account.tier ?? "free", active.length);
    if (!gate.ok) return json(402, { error: gate.error });

    const pass: Pass = {
      id: randomUUID(),
      accountId,
      profile: body.profile,
      recipientLabel: body.recipientLabel.slice(0, 80),
      boardId: body.boardId,
      currentPhase: SYSTEM_DEFAULTS[body.profile].mapping.phaseOrder[0],
      lastUpdatedAt: new Date().toISOString(),
      overrides: {},
    };
    await ctx.stores.savePass(pass);
    // Internal-board passes never touch the card index (webhooks can't reach
    // them; move/manual paths resolve directly) — avoids cross-tenant
    // collisions on the shared "internal" board id.
    if (body.boardId !== "internal") {
      try {
        await ctx.stores.registerCard(body.boardId, body.cardId ?? "*", pass.id);
      } catch (e) {
        return json(409, { error: (e as Error).message });
      }
    }
    const brandingToken = mintBrandingToken(pass.id, 72, ctx.config.linkTokenSecret);
    return json(201, {
      pass,
      brandingUrl: `${ctx.config.publicBaseUrl}/brand/${brandingToken}`,
    });
  }

  // ── GET /api/passes/:id — detail + resolved rules summary ──
  const detail = req.path.match(/^\/api\/passes\/([^/]+)$/);
  if (req.method === "GET" && detail) {
    const pass = (await ctx.stores.listPassesForAccount(accountId)).find((p) => p.id === detail[1]);
    if (!pass) return json(404, { error: "Pass not found." });
    const account = await ctx.stores.getAccount(pass.accountId);
    const profileConfig = await ctx.stores.getProfileConfig(pass.accountId, pass.profile);
    const rules = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);
    return json(200, {
      pass,
      resolvedRules: {
        mapping: rules.mapping,
        significance: { notifyOn: rules.significance.notifyOn, suppress: rules.significance.suppress },
        voice: { tone: rules.voice.tone, denylist: rules.voice.denylist },
        cadence: rules.cadence,
      },
    });
  }

  // ── POST /api/passes/:id/update — the manual send-update escape hatch ──
  const manual = req.path.match(/^\/api\/passes\/([^/]+)\/update$/);
  if (req.method === "POST" && manual) {
    const pass = (await ctx.stores.listPassesForAccount(accountId)).find((p) => p.id === manual[1]);
    if (!pass) return json(404, { error: "Pass not found." });
    const body = parse<{ note?: string; phase?: string }>({});
    if (!body.note) return json(400, { error: "Write the update you want to send." });
    const event: BoardEvent = {
      type: "manual_update",
      boardId: pass.boardId,
      cardId: "manual",
      cardTitle: pass.recipientLabel,
      toColumn: body.phase,          // optional phase move with the note
      note: body.note.slice(0, 500), // data, never instructions — guarded downstream
      explicitDates: [],
    };
    // route manual events to this pass regardless of card index
    const deps: PipelineDeps = { ...ctx.deps, getPassForBoardCard: async () => pass };
    const outcome = await handleBoardEvent(event, deps, ctx.model);
    return json(200, { outcome });
  }

  // ── GET /api/board — passes grouped by phase, per profile (internal board) ──
  if (req.method === "GET" && req.path === "/api/board") {
    const passes = await ctx.stores.listPassesForAccount(accountId);
    const profiles: Record<string, { phases: string[]; passes: Record<string, unknown[]> }> = {};
    for (const p of passes) {
      const phases = SYSTEM_DEFAULTS[p.profile].mapping.phaseOrder;
      profiles[p.profile] ??= { phases, passes: Object.fromEntries(phases.map((ph) => [ph, []])) };
      const bucket = profiles[p.profile].passes[p.currentPhase] ?? (profiles[p.profile].passes[p.currentPhase] = []);
      bucket.push({ id: p.id, recipientLabel: p.recipientLabel, currentRag: p.currentRag ?? null });
    }
    return json(200, { profiles });
  }

  // ── POST /api/passes/:id/move — internal board drag-to-phase ──
  const move = req.path.match(/^\/api\/passes\/([^/]+)\/move$/);
  if (req.method === "POST" && move) {
    const pass = (await ctx.stores.listPassesForAccount(accountId)).find((p) => p.id === move[1]);
    if (!pass) return json(404, { error: "Pass not found." });
    const body = parse<{ phase?: string; note?: string }>({});
    const phases = SYSTEM_DEFAULTS[pass.profile].mapping.phaseOrder;
    if (!body.phase || !phases.includes(body.phase)) {
      return json(400, { error: "phase must be one of: " + phases.join(", ") });
    }
    const event: BoardEvent = {
      type: "phase_change",
      boardId: pass.boardId,
      cardId: "internal",
      cardTitle: pass.recipientLabel,
      fromColumn: pass.currentPhase,
      toColumn: body.phase,               // canonical — identity-mapped in defaults
      note: body.note?.slice(0, 500),     // data, never instructions
      explicitDates: [],
    };
    const deps: PipelineDeps = { ...ctx.deps, getPassForBoardCard: async () => pass };
    const outcome = await handleBoardEvent(event, deps, ctx.model);
    return json(200, { outcome });
  }

  // ── Deliverables: the artifact repo behind the pass's gallery link ──
  const deliv = req.path.match(/^\/api\/passes\/([^/]+)\/deliverables$/);
  if (deliv) {
    const passId = deliv[1];
    const pass = (await ctx.stores.listPassesForAccount(accountId)).find((p) => p.id === passId);
    if (!pass) return json(404, { error: "Pass not found." });

    if (req.method === "GET") {
      const items = await ctx.brandingStore.listDeliverables(passId);
      // A long-lived gallery link the operator can share directly (90 days).
      const galleryUrl = `${ctx.config.publicBaseUrl}/g/${mintGalleryToken(passId, 24 * 90, ctx.config.linkTokenSecret)}`;
      return json(200, { items, galleryUrl });
    }
    if (req.method === "POST") {
      const body = parse<{ kind?: string; title?: string; url?: string }>({});
      if (body.kind !== "link") return json(400, { error: "Use /deliverables/upload for images." });
      const valid = validateLinkDeliverable(body.title, body.url);
      if (!valid.ok) return json(400, valid);
      const d = newDeliverable(passId, { kind: "link", title: body.title!, url: body.url });
      await ctx.brandingStore.addDeliverable(d);
      const outcome = await notifyDeliverable(ctx, pass, d.title);
      return json(201, { deliverable: d, outcome });
    }
    if (req.method === "DELETE") {
      const body = parse<{ id?: string }>({});
      if (!body.id) return json(400, { error: "id is required." });
      await ctx.brandingStore.removeDeliverable(passId, body.id);
      return json(200, { ok: true });
    }
  }

  // POST /api/passes/:id/deliverables/upload?title=... — raw image bytes
  const delivUp = req.path.match(/^\/api\/passes\/([^/]+)\/deliverables\/upload$/);
  if (req.method === "POST" && delivUp) {
    const passId = delivUp[1];
    const pass = (await ctx.stores.listPassesForAccount(accountId)).find((p) => p.id === passId);
    if (!pass) return json(404, { error: "Pass not found." });
    const title = (req.query.get("title") ?? "Deliverable").slice(0, 80);
    const upload = await handleAssetUpload(
      ctx.brandingStore, passId, "logo", // slot field unused for deliverables; validation shared
      req.contentType, req.rawBody,
    );
    if (!upload.ok) return json(400, upload);
    const d = newDeliverable(passId, { kind: "image", title, assetId: upload.assetId });
    await ctx.brandingStore.addDeliverable(d);
    const outcome = await notifyDeliverable(ctx, pass, d.title);
    return json(201, { deliverable: d, outcome });
  }

  // ── GET/PUT /api/mapping — account-level columnToPhase editing ──
  if (req.path === "/api/mapping") {
    const account = await ctx.stores.getAccount(accountId);
    if (req.method === "GET") {
      const merged = { ...SYSTEM_DEFAULTS["client-delivery"].mapping.columnToPhase, ...account.defaults.mapping?.columnToPhase };
      return json(200, { columnToPhase: merged, accountOverrides: account.defaults.mapping?.columnToPhase ?? {} });
    }
    if (req.method === "PUT") {
      const body = parse<{ columnToPhase?: Record<string, string> }>({});
      if (!body.columnToPhase) return json(400, { error: "columnToPhase is required." });
      const clean: Record<string, string> = {};
      for (const [col, phase] of Object.entries(body.columnToPhase)) {
        if (col.trim() && phase.trim()) clean[col.trim()] = phase.trim();
      }
      account.defaults = { ...account.defaults, mapping: { ...account.defaults.mapping, columnToPhase: clean } };
      await ctx.stores.saveAccount(account);
      return json(200, { columnToPhase: clean });
    }
  }

  return json(404, { error: "Unknown console endpoint." });
}

/** A new demo/deliverable is news: run it through the full pipeline so the
 *  stakeholder's pass links straight to the shelf. Cooldown and significance
 *  rules apply as usual (bulk adds won't spam). */
async function notifyDeliverable(ctx: ConsoleContext, pass: Pass, title: string) {
  const event: BoardEvent = {
    type: "deliverable_added",
    boardId: pass.boardId, cardId: "deliverable",
    cardTitle: pass.recipientLabel,
    note: `New deliverable available: ${title}`,
    explicitDates: [],
  };
  const deps: PipelineDeps = { ...ctx.deps, getPassForBoardCard: async () => pass };
  return handleBoardEvent(event, deps, ctx.model);
}
