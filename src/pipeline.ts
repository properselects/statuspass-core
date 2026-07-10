// handleBoardEvent — rules-engine spec §5, end to end.
// All external effects are injected: board lookup, link resolution
// (tokenization + reachability), pass delivery. This keeps the vendor
// (AddToWallet-style API) and Trello behind interfaces per the build doc.

import type {
  Account, BoardEvent, Pass, Profile, ProfileConfig, RagStatus, ResolvedRules,
  ModelClient, ModelRouting,
} from "./types.js";
import { SYSTEM_DEFAULTS } from "./defaults.js";
import { resolveRules } from "./merge.js";
import { evaluateSignificance, withinCooldown } from "./significance.js";
import { formatPassUpdate } from "./format.js";

export interface ResolvedLink { label: string; url: string; expiresAt?: string }

export interface PipelineDeps {
  getPassForBoardCard(event: BoardEvent): Promise<Pass | null>;
  getAccount(accountId: string): Promise<Account>;
  getProfileConfig(accountId: string, profile: Profile): Promise<ProfileConfig | undefined>;
  /** Tokenize + (optionally) verify reachable/auth-free. Return null to ship without a link. */
  resolvePrimaryLink(phase: string, event: BoardEvent, rules: ResolvedRules["link"], passId?: string): Promise<ResolvedLink | null>;
  deliverPassUpdate(pass: Pass, payload: {
    phase: string; rag: RagStatus | null; text: string; link: ResolvedLink | null;
  }): Promise<void>;
  touchPass(pass: Pass, now: Date): Promise<void>;
  notifyOperator(passId: string, message: string): Promise<void>;
  now?(): Date;
}

export type PipelineOutcome =
  | { action: "skipped"; reason: string }
  | { action: "shipped"; text: string; usedFallback: boolean };

export function mapRag(event: BoardEvent, mapping: ResolvedRules["mapping"]): RagStatus | null {
  for (const label of event.labels ?? []) {
    const rag = mapping.labelToRag[label];
    if (rag) return rag;
  }
  return null;
}

export async function handleBoardEvent(
  event: BoardEvent,
  deps: PipelineDeps,
  model: { client: ModelClient; routing: ModelRouting },
): Promise<PipelineOutcome> {
  const now = deps.now?.() ?? new Date();

  const pass = await deps.getPassForBoardCard(event);
  if (!pass) return { action: "skipped", reason: "no-pass-for-card" };

  const account = await deps.getAccount(pass.accountId);
  const profileConfig = await deps.getProfileConfig(pass.accountId, pass.profile);
  const rules = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);

  // Step 2 mapping happens before step 1 significance needs the phase
  const mapped = event.toColumn ? rules.mapping.columnToPhase[event.toColumn] : undefined;
  const phase = mapped ?? pass.currentPhase;
  if (event.type === "phase_change" && event.toColumn && !mapped) {
    // Don't silently stall: tell the operator exactly what to fix.
    await deps.notifyOperator(pass.id,
      `Board column "${event.toColumn}" isn't mapped to a phase yet — add it in Mapping so this pass moves automatically.`);
  }

  // ── Step 1: significance
  const decision = evaluateSignificance(event, rules.significance, phase);
  if (decision === "suppress") return { action: "skipped", reason: "suppressed" };
  if (decision === "ambiguous" && !rules.significance.modelAssistOnAmbiguous) {
    return { action: "skipped", reason: "ambiguous-no-assist" };
  }
  if (withinCooldown(pass, rules.significance.minMinutesBetweenPushes, now)) {
    return { action: "skipped", reason: "cooldown" };
  }

  // ── Step 2/3: rag + link
  const rag = mapRag(event, rules.mapping);
  const link = await deps.resolvePrimaryLink(phase, event, rules.link, pass.id);

  // ── Step 4: format with voice constraints + guardrail
  const result = await formatPassUpdate(
    {
      event, phase, rag, profile: pass.profile,
      voice: rules.voice,
      ctx: { explicitDates: event.explicitDates, internalNames: account.internalNames },
    },
    model.client,
    model.routing,
  );

  // ── Step 5: ship
  await deps.deliverPassUpdate(pass, { phase, rag, text: result.update.text, link });
  await deps.touchPass(pass, now);

  if (result.usedFallback) {
    await deps.notifyOperator(pass.id, "Auto-language was suppressed for the last update (guardrail). A generic status line was shipped.");
  }

  return { action: "shipped", text: result.update.text, usedFallback: result.usedFallback };
}
