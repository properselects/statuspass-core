// evaluateSignificance — rules-engine spec §5 step 1
// suppress > notify > ambiguous. Cooldown checked separately.

import type { BoardEvent, Pass, SignificanceRules } from "./types.js";

export type SignificanceDecision = "notify" | "suppress" | "ambiguous";

export function evaluateSignificance(
  event: BoardEvent,
  rules: SignificanceRules,
  mappedPhase: string | undefined,
): SignificanceDecision {
  // explicit suppression wins — safety rules only tighten
  if (rules.suppress.includes(event.type)) return "suppress";

  // phase allowlist (empty = all eligible)
  if (rules.eligiblePhases.length > 0 && mappedPhase && !rules.eligiblePhases.includes(mappedPhase)) {
    return "suppress";
  }

  if (rules.notifyOn.includes(event.type)) return "notify";
  return "ambiguous";
}

export function withinCooldown(pass: Pass, minMinutes: number, now: Date = new Date()): boolean {
  if (!pass.lastPushAt) return false;
  const elapsedMin = (now.getTime() - new Date(pass.lastPushAt).getTime()) / 60_000;
  return elapsedMin < minMinutes;
}
