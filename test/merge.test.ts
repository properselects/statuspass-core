import { describe, expect, it } from "vitest";
import { resolveRules, mergeRuleSet } from "../src/merge.js";
import { SYSTEM_DEFAULTS } from "../src/defaults.js";
import type { Account, Pass, ProfileConfig } from "../src/types.js";

const account: Account = {
  id: "acc1", name: "Proper Selects", internalNames: ["Dave", "Priya"],
  defaults: {
    voice: { tone: "formal", denylist: ["Acme-internal"] },
    mapping: { columnToPhase: { "Staging": "In Review" } },
  },
};

const profileConfig: ProfileConfig = {
  accountId: "acc1", profile: "client-delivery",
  overrides: { voice: { denylist: ["vendor"] } },
};

const basePass: Pass = {
  id: "p1", accountId: "acc1", profile: "client-delivery",
  recipientLabel: "Acme — CEO", boardId: "b1", currentPhase: "Build",
  lastUpdatedAt: new Date().toISOString(), overrides: {},
};

describe("resolveRules inheritance", () => {
  it("merges account scalars over system defaults", () => {
    const r = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, basePass);
    expect(r.voice.tone).toBe("formal");
  });

  it("deep-merges Record maps by key without wiping siblings", () => {
    const r = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, basePass);
    expect(r.mapping.columnToPhase["Staging"]).toBe("In Review"); // added
    expect(r.mapping.columnToPhase["Review"]).toBe("In Review");  // default preserved
  });

  it("denylist is additive union across layers", () => {
    const pass = { ...basePass, overrides: { voice: { denylist: ["pilot pricing"] } } };
    const r = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);
    expect(r.voice.denylist).toEqual(expect.arrayContaining(["Acme-internal", "vendor", "pilot pricing"]));
  });

  it("suppress is additive — a child layer cannot un-suppress", () => {
    const pass = { ...basePass, overrides: { significance: { suppress: [] as any } } };
    const r = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);
    expect(r.significance.suppress).toEqual(expect.arrayContaining(["subtask_move", "comment_added"]));
  });

  it("neverInventDates cannot be weakened by a child layer", () => {
    const pass = { ...basePass, overrides: { voice: { neverInventDates: false } } };
    const r = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);
    expect(r.voice.neverInventDates).toBe(true);
  });

  it("non-additive arrays replace wholesale", () => {
    const pass = { ...basePass, overrides: { significance: { notifyOn: ["delivered"] as any } } };
    const r = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);
    expect(r.significance.notifyOn).toEqual(["delivered"]);
  });

  it("mergeRuleSet does not mutate the base", () => {
    const base = structuredClone(SYSTEM_DEFAULTS["client-delivery"]);
    const snapshot = structuredClone(base);
    mergeRuleSet(base, { voice: { tone: "casual", denylist: ["x"] } });
    expect(base).toEqual(snapshot);
  });
});
