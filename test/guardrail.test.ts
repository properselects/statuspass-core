import { describe, expect, it } from "vitest";
import { applyGuardrail } from "../src/guardrail.js";
import { evaluateSignificance, withinCooldown } from "../src/significance.js";
import { SYSTEM_DEFAULTS } from "../src/defaults.js";
import type { EventContext, VoiceRules } from "../src/types.js";

const voice: VoiceRules = {
  tone: "professional",
  hideInternalNames: true, hideMoney: true, hideInternalTools: true,
  softenBlockers: true, neverInventDates: true,
  denylist: ["Acme-internal"],
};
const ctx: EventContext = { explicitDates: [], internalNames: ["Dave", "Priya"] };

describe("applyGuardrail — adversarial goldens", () => {
  it("catches an internal name leak", () => {
    const r = applyGuardrail("Waiting on Dave to finish the copy.", voice, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.violations).toContain("name:Dave");
  });

  it("catches an unauthorized invented date", () => {
    for (const text of [
      "The homepage will be done by Friday.",
      "Launch is set for August 1.",
      "Delivery expected next week.",
      "Review lands 08/15.",
      "Done in 3 days.",
    ]) {
      const r = applyGuardrail(text, voice, ctx);
      expect(r.ok, text).toBe(false);
    }
  });

  it("allows a date when one was authorized in source", () => {
    const r = applyGuardrail("Launch is confirmed for August 1.", voice, {
      ...ctx, explicitDates: ["2026-08-01"],
    });
    expect(r.ok).toBe(true);
  });

  it("catches money leakage", () => {
    const r = applyGuardrail("Phase complete, $12,000 remaining in budget.", voice, ctx);
    expect(r.ok).toBe(false);
  });

  it("catches denylist terms case-insensitively", () => {
    const r = applyGuardrail("Details are in acme-internal notes.", voice, ctx);
    expect(r.ok).toBe(false);
  });

  it("passes a clean client-safe line", () => {
    const r = applyGuardrail("The homepage has moved to review and is awaiting final copy.", voice, ctx);
    expect(r.ok).toBe(true);
  });
});

describe("significance + cooldown", () => {
  const sig = SYSTEM_DEFAULTS["client-delivery"].significance;
  const ev = (type: any) => ({
    type, boardId: "b", cardId: "c", cardTitle: "t", explicitDates: [] as string[],
  });

  it("suppresses noise events", () => {
    expect(evaluateSignificance(ev("subtask_move"), sig, "Build")).toBe("suppress");
    expect(evaluateSignificance(ev("comment_added"), sig, "Build")).toBe("suppress");
  });

  it("notifies on phase changes and delivery", () => {
    expect(evaluateSignificance(ev("phase_change"), sig, "In Review")).toBe("notify");
    expect(evaluateSignificance(ev("delivered"), sig, "Delivered")).toBe("notify");
  });

  it("marks unknown events ambiguous", () => {
    expect(evaluateSignificance(ev("due_date_changed"), sig, "Build")).toBe("ambiguous");
  });

  it("enforces cooldown", () => {
    const now = new Date("2026-07-06T12:00:00Z");
    const pass: any = { lastPushAt: "2026-07-06T11:30:00Z" };
    expect(withinCooldown(pass, 60, now)).toBe(true);
    expect(withinCooldown(pass, 15, now)).toBe(false);
  });
});
