// formatPassUpdate — prompt spec §1–5 wired together.
// Model-agnostic: takes a ModelClient + routing config. Harness > model.

import { z } from "zod";
import type {
  BoardEvent, EventContext, ModelClient, ModelRouting,
  PassUpdate, Phase, Profile, RagStatus, VoiceRules,
} from "./types.js";
import { buildUserPayload, renderSystemPrompt } from "./prompt.js";
import { applyGuardrail, safeFallbackText } from "./guardrail.js";

const PassUpdateSchema = z.object({
  text: z.string().min(1).max(200),
  phase: z.string(),
  rag: z.enum(["green", "yellow", "red"]).nullable(),
});

export class PassUpdateError extends Error {}

function parseModelJson(raw: string): unknown {
  // strip accidental fences, tolerate surrounding prose by extracting first {...}
  const cleaned = raw.replace(/```json|```/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new PassUpdateError("no JSON object in model output");
  return JSON.parse(cleaned.slice(start, end + 1));
}

function validatePassUpdate(raw: unknown, expectedPhase: Phase): PassUpdate {
  const parsed = PassUpdateSchema.parse(raw);
  if (parsed.phase !== expectedPhase) throw new PassUpdateError("phase drift");
  return parsed;
}

const ROUTINE: ReadonlySet<string> = new Set(["phase_change", "delivered", "milestone_reached", "deliverable_added"]);

export function pickModel(event: BoardEvent, routing: ModelRouting): string {
  const dense = (event.note?.length ?? 0) > 200;
  return ROUTINE.has(event.type) && !dense ? routing.routine : routing.frontier;
}

export interface FormatResult {
  update: PassUpdate;
  usedFallback: boolean;
  modelUsed: string;
}

export async function formatPassUpdate(
  args: {
    event: BoardEvent;
    phase: Phase;
    rag: RagStatus | null;
    profile: Profile;
    voice: VoiceRules;
    ctx: EventContext;
  },
  client: ModelClient,
  routing: ModelRouting,
): Promise<FormatResult> {
  const { event, phase, rag, profile, voice, ctx } = args;
  const system = renderSystemPrompt(voice, profile);
  const user = buildUserPayload({ event, phase, rag, profile });
  const model = pickModel(event, routing);

  let lastViolations: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    const nudge =
      attempt === 0
        ? ""
        : lastViolations.length
          ? `\n\nYour previous output contained violations: ${lastViolations.join(", ")}. Remove all such content and return only valid JSON matching the schema.`
          : "\n\nReturn only valid JSON matching the schema.";

    let update: PassUpdate;
    try {
      const raw = await client.complete({ system, user: user + nudge, model, maxTokens: 300 });
      update = validatePassUpdate(parseModelJson(raw), phase);
    } catch {
      lastViolations = [];
      continue; // malformed → retry once, then fallback
    }

    const guarded = applyGuardrail(update.text, voice, ctx);
    if (guarded.ok) return { update, usedFallback: false, modelUsed: model };
    lastViolations = guarded.violations;
  }

  // Never ship a leak or a malformed pass — boring true line instead.
  return {
    update: { text: safeFallbackText(phase), phase, rag },
    usedFallback: true,
    modelUsed: model,
  };
}
