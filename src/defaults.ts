// SYSTEM_DEFAULTS — complete base rules per profile (rules-engine spec §3)

import type { Profile, ResolvedRules } from "./types.js";

const clientDelivery: ResolvedRules = {
  mapping: {
    columnToPhase: {
      // identity mappings: canonical phases map to themselves so the
      // internal status board (and any tool using our phase names) resolves
      "Discovery": "Discovery", "Design": "Design", "Build": "Build",
      "In Review": "In Review", "Delivered": "Delivered",
      "Backlog": "Discovery",
      "In Progress": "Build",
      "Doing": "Build",
      "Review": "In Review",
      "QA": "In Review",
      "Done": "Delivered",
    },
    labelToRag: { blocked: "red", "at-risk": "yellow", "on-track": "green" },
    phaseToLinkField: {
      Design: "preview_url",
      Build: "staging_url",
      "In Review": "review_url",
      Delivered: "final_url",
    },
    phaseOrder: ["Discovery", "Design", "Build", "In Review", "Delivered"],
  },
  significance: {
    notifyOn: ["phase_change", "blocked", "unblocked", "delivered", "milestone_reached", "deliverable_added", "manual_update"],
    suppress: ["subtask_move", "comment_added", "card_added"],
    eligiblePhases: [],
    modelAssistOnAmbiguous: false, // v1: rules-only; enable later
    minMinutesBetweenPushes: 60,
  },
  voice: {
    tone: "professional",
    hideInternalNames: true,
    hideMoney: true,
    hideInternalTools: true,
    softenBlockers: true,
    neverInventDates: true,
    denylist: [],
  },
  link: {
    byPhase: {
      Design: { label: "View design preview", source: { type: "board_field", fieldKey: "preview_url" } },
      Build: { label: "View progress", source: { type: "board_field", fieldKey: "staging_url" } },
      "In Review": { label: "Review & approve", source: { type: "board_field", fieldKey: "review_url" } },
      Delivered: { label: "View deliverables", source: { type: "gallery" } },
    },
    tokenTtlHours: 336, // 14 days
    verifyReachable: true,
  },
  cadence: {
    senderNudgeAfterDays: 10,
    reassureAfterDays: 7,
    reassureText: "On track — next update at the upcoming milestone.",
  },
};

const internalProgram: ResolvedRules = {
  ...clientDelivery,
  mapping: {
    ...clientDelivery.mapping,
    columnToPhase: {
      "Planning": "Planning", "Executing": "Executing",
      "In Review": "In Review", "Complete": "Complete",
      "In Progress": "Executing",
      "Blocked": "Blocked",
      "Review": "In Review",
      "Done": "Complete",
    },
    phaseToLinkField: {
      Planning: "charter_url",
      Executing: "status_doc_url",
      Blocked: "decision_doc_url",
      "In Review": "review_doc_url",
      Complete: "summary_url",
    },
    phaseOrder: ["Planning", "Executing", "In Review", "Complete"],
  },
  voice: {
    ...clientDelivery.voice,
    tone: "professional",
    hideMoney: false, // internal sponsors often need budget signal
  },
  link: {
    ...clientDelivery.link,
    byPhase: {
      Planning: { label: "View charter", source: { type: "board_field", fieldKey: "charter_url" } },
      Executing: { label: "View status", source: { type: "board_field", fieldKey: "status_doc_url" } },
      Blocked: { label: "Decision needed", source: { type: "board_field", fieldKey: "decision_doc_url" } },
      "In Review": { label: "Review", source: { type: "board_field", fieldKey: "review_doc_url" } },
      Complete: { label: "View deliverables", source: { type: "gallery" } },
    },
  },
};

export const SYSTEM_DEFAULTS: Record<Profile, ResolvedRules> = {
  "client-delivery": clientDelivery,
  "internal-program": internalProgram,
};
