// applyGuardrail — deterministic post-filter. The prompt reduces violations;
// this guarantees them. Identical regardless of which model generated the text.

import type { EventContext, VoiceRules } from "./types.js";

export type GuardrailResult =
  | { ok: true; text: string }
  | { ok: false; violations: string[] };

// Conservative date-like patterns: month names, numeric dates, ISO, relative timing.
const DATE_LIKE = new RegExp(
  [
    String.raw`\b(jan(uary)?|feb(ruary)?|mar(ch)?|apr(il)?|may|jun(e)?|jul(y)?|aug(ust)?|sep(t(ember)?)?|oct(ober)?|nov(ember)?|dec(ember)?)\b\.?\s*\d{0,2}`,
    String.raw`\b\d{1,2}[/-]\d{1,2}([/-]\d{2,4})?\b`,
    String.raw`\b\d{4}-\d{2}-\d{2}\b`,
    String.raw`\bby (mon|tues|wednes|thurs|fri|satur|sun)day\b`,
    String.raw`\b(next|this) (week|month|quarter)\b`,
    String.raw`\bin \d+ (day|week|month)s?\b`,
    String.raw`\b(tomorrow|tonight|eod|eow)\b`,
  ].join("|"),
  "i",
);

const MONEY_LIKE = new RegExp(
  [
    String.raw`\$\s?\d`,
    String.raw`\b\d[\d,.]*\s?(usd|dollars?)\b`,
    String.raw`\b\d+k\s?(budget|cost|fee)\b`,
  ].join("|"),
  "i",
);

function containsCI(haystack: string, needle: string): boolean {
  return needle.length > 0 && haystack.toLowerCase().includes(needle.toLowerCase());
}

export function applyGuardrail(
  text: string,
  voice: VoiceRules,
  ctx: EventContext,
): GuardrailResult {
  const violations: string[] = [];

  // 1. Denylist — hard substring match, case-insensitive
  for (const term of voice.denylist) {
    if (containsCI(text, term)) violations.push(`denylist:${term}`);
  }

  // 2. neverInventDates — if no date authorized, none may appear
  if (voice.neverInventDates && ctx.explicitDates.length === 0 && DATE_LIKE.test(text)) {
    violations.push("unauthorized-date");
  }

  // 3. Money
  if (voice.hideMoney && MONEY_LIKE.test(text)) violations.push("money");

  // 4. Internal names — checked against the account's known team list
  if (voice.hideInternalNames) {
    for (const name of ctx.internalNames) {
      if (containsCI(text, name)) violations.push(`name:${name}`);
    }
  }

  return violations.length ? { ok: false, violations } : { ok: true, text };
}

/** Boring-but-true fallback when generation fails guardrail twice. */
export function safeFallbackText(phase: string): string {
  return `Update: now in ${phase}.`;
}
