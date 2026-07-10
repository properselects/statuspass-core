// Cadence job + storage interfaces — rules-engine spec §5 (cadence runs on a
// timer, not on events) and the build doc's staleness rules. Silence must
// never read as "project is dead."

import type { Account, Pass, Profile, ProfileConfig, RagStatus } from "./types.js";
import { SYSTEM_DEFAULTS } from "./defaults.js";
import { resolveRules } from "./merge.js";

// ── Storage interface (swap in Supabase/Postgres for prod) ───

export interface Stores {
  getAccount(accountId: string): Promise<Account>;
  getAccountByEmail(email: string): Promise<Account | null>;
  getProfileConfig(accountId: string, profile: Profile): Promise<ProfileConfig | undefined>;
  getPassForBoardCard(boardId: string, cardId: string): Promise<Pass | null>;
  listActivePasses(): Promise<Pass[]>;                    // cadence job (all tenants)
  listPassesForAccount(accountId: string): Promise<Pass[]>; // console (scoped)
  savePass(pass: Pass): Promise<void>;
  saveAccount(account: Account): Promise<void>;
  /** Throws if (boardId,cardId) is already claimed by another account's pass —
   *  surfaces cross-tenant board collisions at registration, not delivery. */
  registerCard(boardId: string, cardId: string, passId: string): Promise<void>;
}

export class InMemoryStores implements Stores {
  accounts = new Map<string, Account>();
  profileConfigs = new Map<string, ProfileConfig>(); // key: accountId:profile
  passes = new Map<string, Pass>();
  /** boardId:cardId → passId */
  cardIndex = new Map<string, string>();

  async getAccount(id: string) {
    const a = this.accounts.get(id);
    if (!a) throw new Error(`no account ${id}`);
    return a;
  }
  async getAccountByEmail(email: string) {
    for (const a of this.accounts.values()) if (a.email?.toLowerCase() === email.toLowerCase()) return a;
    return null;
  }
  async listPassesForAccount(accountId: string) {
    return [...this.passes.values()].filter((p) => p.accountId === accountId);
  }
  async getProfileConfig(accountId: string, profile: Profile) {
    return this.profileConfigs.get(`${accountId}:${profile}`);
  }
  async getPassForBoardCard(boardId: string, cardId: string) {
    const id = this.cardIndex.get(`${boardId}:${cardId}`) ?? this.cardIndex.get(`${boardId}:*`);
    return id ? this.passes.get(id) ?? null : null;
  }
  async listActivePasses() {
    return [...this.passes.values()];
  }
  async savePass(pass: Pass) {
    this.passes.set(pass.id, pass);
  }
  async saveAccount(account: Account) {
    this.accounts.set(account.id, account);
  }
  async registerCard(boardId: string, cardId: string, passId: string) {
    const key = `${boardId}:${cardId}`;
    const existing = this.cardIndex.get(key);
    if (existing && existing !== passId) {
      const mine = this.passes.get(passId);
      const theirs = this.passes.get(existing);
      if (mine && theirs && mine.accountId !== theirs.accountId) {
        throw new Error(`board "${boardId}" is already connected to another account`);
      }
    }
    this.cardIndex.set(key, passId);
  }
}

// ── Cadence job ──────────────────────────────────────────────

export interface CadenceDeps {
  stores: Stores;
  deliverPassUpdate(pass: Pass, payload: {
    phase: string; rag: RagStatus | null; text: string; link: null;
  }): Promise<void>;
  notifyOperator(passId: string, message: string): Promise<void>;
  now?(): Date;
}

export interface CadenceReport {
  nudged: string[];    // pass ids where operator was nudged
  reassured: string[]; // pass ids where "on track" was pushed
}

const DAY_MS = 86_400_000;

/**
 * Run on a schedule (e.g. hourly). For each active pass:
 *  - quiet > reassureAfterDays  → push the reassureText "on track" state
 *    (once — pushing it counts as an update, resetting the clock)
 *  - quiet > senderNudgeAfterDays → nudge the operator to send a real update
 */
export async function runCadenceJob(deps: CadenceDeps): Promise<CadenceReport> {
  const now = deps.now?.() ?? new Date();
  const report: CadenceReport = { nudged: [], reassured: [] };

  for (const pass of await deps.stores.listActivePasses()) {
    const account = await deps.stores.getAccount(pass.accountId);
    const profileConfig = await deps.stores.getProfileConfig(pass.accountId, pass.profile);
    const rules = resolveRules(SYSTEM_DEFAULTS, account, profileConfig, pass);
    const quietDays = (now.getTime() - new Date(pass.lastUpdatedAt).getTime()) / DAY_MS;

    if (quietDays > rules.cadence.reassureAfterDays) {
      await deps.deliverPassUpdate(pass, {
        phase: pass.currentPhase,
        rag: pass.currentRag ?? null,
        text: rules.cadence.reassureText,
        link: null, // reassure keeps the existing link; never mint a stale one
      });
      pass.lastUpdatedAt = now.toISOString();
      await deps.stores.savePass(pass);
      report.reassured.push(pass.id);
    }

    if (quietDays > rules.cadence.senderNudgeAfterDays) {
      await deps.notifyOperator(
        pass.id,
        `"${pass.recipientLabel}" hasn't had a real update in ${Math.floor(quietDays)} days.`,
      );
      report.nudged.push(pass.id);
    }
  }
  return report;
}
