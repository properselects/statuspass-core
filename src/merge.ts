// mergeRuleSet + resolveRules — rules-engine spec §4
// Merge semantics:
//  - scalars: later layer wins if present
//  - Record<> maps: deep-merged by key
//  - arrays: replace wholesale, EXCEPT suppress + denylist (additive union)
//  - invariant: voice.neverInventDates can tighten (→true) but never loosen

import type { Account, Pass, Profile, ProfileConfig, ResolvedRules, RuleSet } from "./types.js";

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const ADDITIVE_ARRAYS = new Set(["suppress", "denylist"]);

function mergeSection(base: any, override: any, path: string[] = []): any {
  if (override === undefined) return base;
  if (Array.isArray(base) && Array.isArray(override)) {
    const key = path[path.length - 1];
    if (ADDITIVE_ARRAYS.has(key)) {
      return Array.from(new Set([...base, ...override])); // tighten-only: union
    }
    return override; // wholesale replace
  }
  if (isPlainObject(base) && isPlainObject(override)) {
    const out: Record<string, unknown> = { ...base };
    for (const k of Object.keys(override)) {
      out[k] = mergeSection((base as any)[k], (override as any)[k], [...path, k]);
    }
    return out;
  }
  return override; // scalar or type-mismatch: later wins
}

export function mergeRuleSet(base: ResolvedRules, override: RuleSet): ResolvedRules {
  const merged = mergeSection(base, override) as ResolvedRules;

  // Hard invariant: neverInventDates can never be weakened by a child layer.
  if (base.voice.neverInventDates === true) {
    merged.voice.neverInventDates = true;
  }
  return merged;
}

export function resolveRules(
  systemDefaults: Record<Profile, ResolvedRules>,
  account: Account,
  profileConfig: ProfileConfig | undefined,
  pass: Pass,
): ResolvedRules {
  const layers: RuleSet[] = [
    account.defaults ?? {},
    profileConfig?.overrides ?? {},
    pass.overrides ?? {},
  ];
  let resolved = structuredClone(systemDefaults[pass.profile]);
  for (const layer of layers) resolved = mergeRuleSet(resolved, layer);
  validateResolved(resolved);
  return resolved;
}

// Reject if a required section is missing post-merge — that's a bad system
// default (deploy-time bug), not a runtime condition.
function validateResolved(r: ResolvedRules): void {
  const sections = ["mapping", "significance", "voice", "link", "cadence"] as const;
  for (const s of sections) {
    if (!r[s] || !isPlainObject(r[s])) {
      throw new Error(`resolveRules: section "${s}" missing after merge — check SYSTEM_DEFAULTS`);
    }
  }
  if (typeof r.voice.neverInventDates !== "boolean") {
    throw new Error("resolveRules: voice.neverInventDates unresolved");
  }
}
