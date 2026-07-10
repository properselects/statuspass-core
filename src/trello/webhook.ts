// Trello webhook endpoint — framework-agnostic.
// Trello signs webhooks: base64(HMACSHA1(body + callbackURL, apiSecret))
// sent in the x-trello-webhook header. Verify before trusting anything.
// Trello also sends a HEAD/GET on webhook creation → respond 200.

import { createHmac, timingSafeEqual } from "node:crypto";
import type { ModelClient, ModelRouting } from "../types.js";
import type { PipelineDeps, PipelineOutcome } from "../pipeline.js";
import { handleBoardEvent } from "../pipeline.js";
import { trelloToBoardEvent, type TrelloWebhookPayload } from "./translate.js";

export function verifyTrelloSignature(args: {
  rawBody: string;
  callbackUrl: string;
  header: string | undefined;
  apiSecret: string;
}): boolean {
  const { rawBody, callbackUrl, header, apiSecret } = args;
  if (!header) return false;
  const expected = createHmac("sha1", apiSecret).update(rawBody + callbackUrl).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface WebhookRequest {
  method: string;
  rawBody: string;
  headers: Record<string, string | undefined>;
}

export interface WebhookResponse {
  status: number;
  body: string;
}

export interface TrelloWebhookConfig {
  callbackUrl: string;
  apiSecret: string;
  /** Optionally fetch card custom fields / labels before translating. */
  enrich?(payload: TrelloWebhookPayload): Promise<{
    customFields?: Record<string, string>;
    labels?: string[];
  }>;
}

/**
 * Framework-agnostic handler. Wrap in Express / an Edge Function:
 * pass method, RAW body string (before JSON parsing — signature needs it),
 * and headers; send back { status, body }.
 *
 * Always 200s translated-but-skipped events — Trello disables webhooks
 * that repeatedly non-2xx.
 */
export async function handleTrelloWebhook(
  req: WebhookRequest,
  config: TrelloWebhookConfig,
  deps: PipelineDeps,
  model: { client: ModelClient; routing: ModelRouting },
): Promise<WebhookResponse & { outcome?: PipelineOutcome }> {
  // Webhook creation handshake
  if (req.method === "HEAD" || req.method === "GET") {
    return { status: 200, body: "ok" };
  }
  if (req.method !== "POST") return { status: 405, body: "method not allowed" };

  const sig = req.headers["x-trello-webhook"];
  if (!verifyTrelloSignature({
    rawBody: req.rawBody,
    callbackUrl: config.callbackUrl,
    header: sig,
    apiSecret: config.apiSecret,
  })) {
    return { status: 401, body: "bad signature" };
  }

  let payload: TrelloWebhookPayload;
  try {
    payload = JSON.parse(req.rawBody);
  } catch {
    return { status: 400, body: "bad json" };
  }

  const extras = config.enrich ? await config.enrich(payload) : {};
  const event = trelloToBoardEvent(payload, extras);
  if (!event) return { status: 200, body: "ignored" };

  const outcome = await handleBoardEvent(event, deps, model);
  return { status: 200, body: outcome.action, outcome };
}
