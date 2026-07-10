// Supabase-backed stores — production swap for the in-memory dev stores.
// Uses the service-role key (server-side only; bypasses RLS). Row↔domain
// mapping is exported so it can be unit-tested without a live database.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Account, Pass, Profile, ProfileConfig, RuleSet } from "./types.js";
import type { ConsoleStores } from "./console/api.js";
import type { BrandingRecord, BrandingStore, StoredAsset } from "./branding.js";
import type { Deliverable } from "./types.js";

// ── Row shapes + mapping (exported for tests) ────────────────

export interface PassRow {
  id: string; account_id: string; profile: Profile; recipient_label: string;
  board_id: string; current_phase: string; current_rag: string | null;
  primary_link: Pass["primaryLink"] | null;
  add_url: string | null;
  last_updated_at: string; last_push_at: string | null;
  overrides: RuleSet; vendor_serial: string | null; active: boolean;
}

export function rowToPass(r: PassRow): Pass {
  return {
    id: r.id, accountId: r.account_id, profile: r.profile,
    recipientLabel: r.recipient_label, boardId: r.board_id,
    currentPhase: r.current_phase,
    currentRag: (r.current_rag as Pass["currentRag"]) ?? undefined,
    primaryLink: r.primary_link ?? undefined,
    addUrl: r.add_url ?? undefined,
    lastUpdatedAt: r.last_updated_at,
    lastPushAt: r.last_push_at ?? undefined,
    overrides: r.overrides ?? {},
  };
}

export function passToRow(p: Pass): Omit<PassRow, "vendor_serial" | "active"> {
  return {
    id: p.id, account_id: p.accountId, profile: p.profile,
    recipient_label: p.recipientLabel, board_id: p.boardId,
    current_phase: p.currentPhase, current_rag: p.currentRag ?? null,
    primary_link: p.primaryLink ?? null,
    add_url: p.addUrl ?? null,
    last_updated_at: p.lastUpdatedAt, last_push_at: p.lastPushAt ?? null,
    overrides: p.overrides ?? {},
  };
}

interface AccountRow {
  id: string; name: string; defaults: RuleSet; internal_names: string[];
  email: string | null; password_hash: string | null;
  tier: string | null; stripe_customer_id: string | null;
}

export function rowToAccount(r: AccountRow): Account {
  return {
    id: r.id, name: r.name, defaults: r.defaults ?? {}, internalNames: r.internal_names ?? [],
    email: r.email ?? undefined, passwordHash: r.password_hash ?? undefined,
    tier: (r.tier as Account["tier"]) ?? "free",
    stripeCustomerId: r.stripe_customer_id ?? undefined,
  };
}

// ── Stores ───────────────────────────────────────────────────

export class SupabaseStores implements ConsoleStores {
  constructor(private readonly db: SupabaseClient) {}

  async getAccount(accountId: string): Promise<Account> {
    const { data, error } = await this.db.from("accounts").select("*").eq("id", accountId).maybeSingle();
    if (error) throw new Error(`supabase getAccount: ${error.message}`);
    if (!data) throw new Error(`no account ${accountId}`);
    return rowToAccount(data as AccountRow);
  }

  async saveAccount(account: Account): Promise<void> {
    const { error } = await this.db.from("accounts").upsert({
      id: account.id, name: account.name,
      defaults: account.defaults ?? {}, internal_names: account.internalNames ?? [],
      email: account.email ?? null, password_hash: account.passwordHash ?? null,
      tier: account.tier ?? "free", stripe_customer_id: account.stripeCustomerId ?? null,
    });
    if (error) throw new Error(`supabase saveAccount: ${error.message}`);
  }

  async getAccountByEmail(email: string): Promise<Account | null> {
    const { data, error } = await this.db.from("accounts").select("*").eq("email", email.toLowerCase()).maybeSingle();
    if (error) throw new Error(`supabase getAccountByEmail: ${error.message}`);
    return data ? rowToAccount(data as AccountRow) : null;
  }

  async listPassesForAccount(accountId: string): Promise<Pass[]> {
    const { data, error } = await this.db.from("passes").select("*")
      .eq("account_id", accountId).eq("active", true);
    if (error) throw new Error(`supabase listPassesForAccount: ${error.message}`);
    return (data as PassRow[]).map(rowToPass);
  }

  async getProfileConfig(accountId: string, profile: Profile): Promise<ProfileConfig | undefined> {
    const { data, error } = await this.db.from("profile_configs").select("*")
      .eq("account_id", accountId).eq("profile", profile).maybeSingle();
    if (error) throw new Error(`supabase getProfileConfig: ${error.message}`);
    return data ? { accountId, profile, overrides: (data as { overrides: RuleSet }).overrides ?? {} } : undefined;
  }

  async getPassForBoardCard(boardId: string, cardId: string): Promise<Pass | null> {
    // exact card match first, then board-wide wildcard
    for (const key of [cardId, "*"]) {
      const { data, error } = await this.db.from("card_index").select("pass_id")
        .eq("board_id", boardId).eq("card_id", key).maybeSingle();
      if (error) throw new Error(`supabase card_index: ${error.message}`);
      if (data) {
        const { data: row, error: pErr } = await this.db.from("passes").select("*")
          .eq("id", (data as { pass_id: string }).pass_id).eq("active", true).maybeSingle();
        if (pErr) throw new Error(`supabase pass lookup: ${pErr.message}`);
        if (row) return rowToPass(row as PassRow);
      }
    }
    return null;
  }

  async listActivePasses(): Promise<Pass[]> {
    const { data, error } = await this.db.from("passes").select("*").eq("active", true);
    if (error) throw new Error(`supabase listActivePasses: ${error.message}`);
    return (data as PassRow[]).map(rowToPass);
  }

  async savePass(pass: Pass): Promise<void> {
    const { error } = await this.db.from("passes").upsert(passToRow(pass));
    if (error) throw new Error(`supabase savePass: ${error.message}`);
  }

  async registerCard(boardId: string, cardId: string, passId: string): Promise<void> {
    const { data: existing } = await this.db.from("card_index").select("pass_id")
      .eq("board_id", boardId).eq("card_id", cardId).maybeSingle();
    const existingId = (existing as { pass_id: string } | null)?.pass_id;
    if (existingId && existingId !== passId) {
      const [{ data: mine }, { data: theirs }] = await Promise.all([
        this.db.from("passes").select("account_id").eq("id", passId).maybeSingle(),
        this.db.from("passes").select("account_id").eq("id", existingId).maybeSingle(),
      ]);
      if ((mine as any)?.account_id !== (theirs as any)?.account_id) {
        throw new Error(`board "${boardId}" is already connected to another account`);
      }
    }
    const { error } = await this.db.from("card_index").upsert({ board_id: boardId, card_id: cardId, pass_id: passId });
    if (error) throw new Error(`supabase registerCard: ${error.message}`);
  }

  // Used by the WalletWallet adapter's getPassMeta/saveSerial wiring.
  async getVendorSerial(passId: string): Promise<string | null> {
    const { data, error } = await this.db.from("passes").select("vendor_serial").eq("id", passId).maybeSingle();
    if (error) throw new Error(`supabase getVendorSerial: ${error.message}`);
    return (data as { vendor_serial: string | null } | null)?.vendor_serial ?? null;
  }

  async saveVendorSerial(passId: string, serial: string): Promise<void> {
    const { error } = await this.db.from("passes").update({ vendor_serial: serial }).eq("id", passId);
    if (error) throw new Error(`supabase saveVendorSerial: ${error.message}`);
  }
}

// ── Branding store (Postgres rows + Storage bucket bytes) ────

const BUCKET = "branding-assets";

export class SupabaseBrandingStore implements BrandingStore {
  constructor(private readonly db: SupabaseClient) {}

  async getBranding(passId: string): Promise<BrandingRecord | null> {
    const { data, error } = await this.db.from("branding").select("*").eq("pass_id", passId).maybeSingle();
    if (error) throw new Error(`supabase getBranding: ${error.message}`);
    if (!data) return null;
    const r = data as Record<string, string | null>;
    return {
      passId, title: r.title ?? "", operatorName: r.operator_name ?? "",
      brandColor: r.brand_color ?? undefined,
      logoAssetId: r.logo_asset_id ?? undefined,
      stripAssetId: r.strip_asset_id ?? undefined,
      completedAt: r.completed_at ?? undefined,
    };
  }

  async saveBranding(record: BrandingRecord): Promise<void> {
    const { error } = await this.db.from("branding").upsert({
      pass_id: record.passId, title: record.title, operator_name: record.operatorName,
      brand_color: record.brandColor ?? null,
      logo_asset_id: record.logoAssetId ?? null,
      strip_asset_id: record.stripAssetId ?? null,
      completed_at: record.completedAt ?? null,
    });
    if (error) throw new Error(`supabase saveBranding: ${error.message}`);
  }

  async saveAsset(asset: StoredAsset): Promise<void> {
    const { error: metaErr } = await this.db.from("assets").upsert({ id: asset.id, content_type: asset.contentType });
    if (metaErr) throw new Error(`supabase asset meta: ${metaErr.message}`);
    const { error } = await this.db.storage.from(BUCKET)
      .upload(asset.id, asset.bytes, { contentType: asset.contentType, upsert: true });
    if (error) throw new Error(`supabase asset upload: ${error.message}`);
  }

  async listDeliverables(passId: string): Promise<Deliverable[]> {
    const { data, error } = await this.db.from("deliverables").select("*").eq("pass_id", passId);
    if (error) throw new Error(`supabase listDeliverables: ${error.message}`);
    return (data as Array<Record<string, string | null>>).map((r) => ({
      id: r.id as string, passId, kind: r.kind as Deliverable["kind"],
      title: (r.title as string) ?? "", assetId: r.asset_id ?? undefined,
      url: r.url ?? undefined, addedAt: r.added_at as string,
    }));
  }

  async addDeliverable(d: Deliverable): Promise<void> {
    const { error } = await this.db.from("deliverables").upsert({
      id: d.id, pass_id: d.passId, kind: d.kind, title: d.title,
      asset_id: d.assetId ?? null, url: d.url ?? null, added_at: d.addedAt,
    });
    if (error) throw new Error(`supabase addDeliverable: ${error.message}`);
  }

  async removeDeliverable(passId: string, id: string): Promise<void> {
    const { error } = await this.db.from("deliverables").delete().eq("pass_id", passId).eq("id", id);
    if (error) throw new Error(`supabase removeDeliverable: ${error.message}`);
  }

  async getAsset(id: string): Promise<StoredAsset | null> {
    const { data: meta, error: metaErr } = await this.db.from("assets").select("content_type").eq("id", id).maybeSingle();
    if (metaErr) throw new Error(`supabase asset meta: ${metaErr.message}`);
    if (!meta) return null;
    const { data, error } = await this.db.storage.from(BUCKET).download(id);
    if (error || !data) return null;
    return {
      id,
      contentType: (meta as { content_type: string }).content_type,
      bytes: Buffer.from(await data.arrayBuffer()),
    };
  }
}

// ── Factory used by server.ts when env is present ────────────

export function createSupabase(url: string, serviceKey: string): {
  stores: SupabaseStores; brandingStore: SupabaseBrandingStore;
} {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  return { stores: new SupabaseStores(db), brandingStore: new SupabaseBrandingStore(db) };
}
