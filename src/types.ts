// StatusPass core types — mirrors statuspass-rules-engine.md §2–3

export type Profile = "internal-program" | "client-delivery";
export type RagStatus = "green" | "yellow" | "red";
export type Phase = string;

export type BoardEventType =
  | "phase_change" | "blocked" | "unblocked" | "delivered"
  | "milestone_reached" | "deliverable_added" | "card_added" | "subtask_move"
  | "comment_added" | "due_date_changed" | "manual_update";

// ── Rule layers ──────────────────────────────────────────────

export interface MappingRules {
  columnToPhase: Record<string, Phase>;
  labelToRag: Record<string, RagStatus>;
  phaseToLinkField: Record<Phase, string>;
  phaseOrder: Phase[];
}

export interface SignificanceRules {
  notifyOn: BoardEventType[];
  suppress: BoardEventType[];
  eligiblePhases: Phase[]; // empty = all mapped phases eligible
  modelAssistOnAmbiguous: boolean;
  minMinutesBetweenPushes: number;
}

export interface VoiceRules {
  tone: "formal" | "professional" | "casual";
  hideInternalNames: boolean;
  hideMoney: boolean;
  hideInternalTools: boolean;
  softenBlockers: boolean;
  neverInventDates: boolean; // tighten-only invariant
  customGuidance?: string;
  denylist: string[]; // additive-only down the hierarchy
}

export type LinkSource =
  | { type: "board_field"; fieldKey: string }
  | { type: "static"; url: string }
  | { type: "gallery" }   // the pass's hosted deliverables gallery
  | { type: "none" };

export interface Deliverable {
  id: string;
  passId: string;
  kind: "image" | "link";
  title: string;
  assetId?: string; // kind=image
  url?: string;     // kind=link
  addedAt: string;
}

export interface LinkRules {
  byPhase: Record<Phase, { label: string; source: LinkSource }>;
  fallback?: { label: string; url: string };
  tokenTtlHours: number;
  verifyReachable: boolean;
}

export interface CadenceRules {
  senderNudgeAfterDays: number;
  reassureAfterDays: number;
  reassureText: string;
}

// ── Containers ───────────────────────────────────────────────

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export interface RuleSet {
  mapping?: DeepPartial<MappingRules>;
  significance?: Partial<SignificanceRules>;
  voice?: Partial<VoiceRules>;
  link?: DeepPartial<LinkRules>;
  cadence?: Partial<CadenceRules>;
}

export interface ResolvedRules {
  mapping: MappingRules;
  significance: SignificanceRules;
  voice: VoiceRules;
  link: LinkRules;
  cadence: CadenceRules;
}

// ── Storage shapes ───────────────────────────────────────────

export interface Account {
  id: string;
  name: string;
  defaults: RuleSet;
  internalNames: string[]; // team-member names for the guardrail
  email?: string;          // operator login + notification target
  passwordHash?: string;
  tier?: "free" | "solo" | "studio" | "agency"; // default free
  stripeCustomerId?: string;
}

export interface ProfileConfig {
  accountId: string;
  profile: Profile;
  overrides: RuleSet;
}

export interface Pass {
  id: string;
  accountId: string;
  profile: Profile;
  recipientLabel: string;
  boardId: string;
  currentPhase: Phase;
  currentRag?: RagStatus;
  primaryLink?: { label: string; url: string; expiresAt?: string };
  addUrl?: string;       // vendor hosted add-to-wallet page, set at issuance
  lastUpdatedAt: string; // ISO
  lastPushAt?: string;   // ISO — cooldown tracking
  overrides: RuleSet;
}

// ── Events & outputs ─────────────────────────────────────────

export interface BoardEvent {
  type: BoardEventType;
  boardId: string;
  cardId: string;
  cardTitle: string;
  fromColumn?: string;
  toColumn?: string;
  labels?: string[];
  note?: string;
  explicitDates: string[]; // ONLY dates the model may use
  fields?: Record<string, string>; // custom fields incl. link fields
}

export interface PassUpdate {
  text: string;
  phase: Phase;
  rag: RagStatus | null;
}

export interface EventContext {
  explicitDates: string[];
  internalNames: string[];
}

// ── Model abstraction (harness > model) ──────────────────────

export interface ModelClient {
  /** Return raw model text for a system+user prompt pair. */
  complete(args: { system: string; user: string; model: string; maxTokens?: number }): Promise<string>;
}

export interface ModelRouting {
  routine: string;  // e.g. "claude-sonnet-4-6"
  frontier: string; // e.g. "claude-fable-5" — config, not code
}
