import { describe, expect, it } from "vitest";
import { SupabaseStores, SupabaseBrandingStore, rowToPass, passToRow, rowToAccount, type PassRow } from "../src/supabase.js";
import type { Pass } from "../src/types.js";

// ── Row mapping round-trips (where the real bugs live) ──────

describe("row mapping", () => {
  const pass: Pass = {
    id: "p1", accountId: "a1", profile: "client-delivery", recipientLabel: "Acme — CEO",
    boardId: "b1", currentPhase: "In Review", currentRag: "yellow",
    primaryLink: { label: "Review & approve", url: "https://x/l/t", expiresAt: "2026-07-20T00:00:00Z" },
    lastUpdatedAt: "2026-07-07T12:00:00Z", lastPushAt: "2026-07-07T12:00:00Z",
    overrides: { voice: { tone: "formal" } },
  };

  it("pass → row → pass survives intact", () => {
    const row = { ...passToRow(pass), vendor_serial: null, active: true } as PassRow;
    expect(rowToPass(row)).toEqual(pass);
  });

  it("nulls become undefined coming out of rows", () => {
    const row: PassRow = {
      id: "p2", account_id: "a1", profile: "internal-program", recipient_label: "Globex — CFO",
      board_id: "b2", current_phase: "Planning", current_rag: null, primary_link: null, add_url: null,
      last_updated_at: "2026-07-07T12:00:00Z", last_push_at: null, overrides: {},
      vendor_serial: null, active: true,
    };
    const p = rowToPass(row);
    expect(p.currentRag).toBeUndefined();
    expect(p.primaryLink).toBeUndefined();
    expect(p.lastPushAt).toBeUndefined();
  });

  it("account rows map with defaults", () => {
    const a = rowToAccount({ id: "a1", name: "Agency", defaults: { voice: { tone: "formal" } }, internal_names: ["Dave"], email: null, password_hash: null, tier: null, stripe_customer_id: null });
    expect(a.internalNames).toEqual(["Dave"]);
    expect(a.defaults.voice?.tone).toBe("formal");
  });
});

// ── Store logic against a faked supabase-js surface ──────────

type Row = Record<string, any>;

function fakeSupabase(tables: Record<string, Row[]>, storage = new Map<string, { bytes: Buffer; contentType: string }>()) {
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const makeQuery = () => {
      const filters: Array<[string, any]> = [];
      const q: any = {
        select: () => q,
        eq: (col: string, val: any) => { filters.push([col, val]); return q; },
        maybeSingle: async () => {
          const hit = rows.find((r) => filters.every(([c, v]) => r[c] === v));
          return { data: hit ?? null, error: null };
        },
        then: (resolve: any) => {
          const hits = rows.filter((r) => filters.every(([c, v]) => r[c] === v));
          return Promise.resolve({ data: hits, error: null }).then(resolve);
        },
        update: (patch: Row) => ({
          eq: async (col: string, val: any) => {
            rows.filter((r) => r[col] === val).forEach((r) => Object.assign(r, patch));
            return { error: null };
          },
        }),
      };
      return q;
    };
    return {
      select: () => makeQuery().select(),
      update: (patch: Row) => makeQuery().update(patch),
      upsert: async (row: Row) => {
        const keys = table === "card_index" ? ["board_id", "card_id"]
          : table === "profile_configs" ? ["account_id", "profile"]
          : table === "branding" ? ["pass_id"] : ["id"];
        const idx = rows.findIndex((r) => keys.every((k) => r[k] === row[k]));
        if (idx >= 0) rows[idx] = { ...rows[idx], ...row };
        else rows.push({ active: true, vendor_serial: null, ...row });
        return { error: null };
      },
    };
  };
  return {
    from,
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Buffer, opts: { contentType: string }) => {
          storage.set(path, { bytes, contentType: opts.contentType });
          return { error: null };
        },
        download: async (path: string) => {
          const hit = storage.get(path);
          return hit
            ? { data: new Blob([new Uint8Array(hit.bytes)]), error: null }
            : { data: null, error: { message: "not found" } };
        },
      }),
    },
  } as any;
}

describe("SupabaseStores", () => {
  it("save/list/lookup round trip with wildcard card fallback", async () => {
    const db = fakeSupabase({});
    const stores = new SupabaseStores(db);
    await stores.saveAccount({ id: "a1", name: "Agency", defaults: {}, internalNames: [] });
    const pass: Pass = {
      id: "p1", accountId: "a1", profile: "client-delivery", recipientLabel: "Acme — CEO",
      boardId: "b1", currentPhase: "Build", lastUpdatedAt: "2026-07-07T12:00:00Z", overrides: {},
    };
    await stores.savePass(pass);
    await stores.registerCard("b1", "*", "p1");

    expect((await stores.listActivePasses())[0].recipientLabel).toBe("Acme — CEO");
    // exact card miss falls back to board wildcard
    expect((await stores.getPassForBoardCard("b1", "card999"))?.id).toBe("p1");
    expect(await stores.getPassForBoardCard("b2", "card1")).toBeNull();

    await stores.saveVendorSerial("p1", "WW-9");
    expect(await stores.getVendorSerial("p1")).toBe("WW-9");
    expect((await stores.getAccount("a1")).name).toBe("Agency");
    await expect(stores.getAccount("missing")).rejects.toThrow(/no account/);
  });
});

describe("SupabaseBrandingStore", () => {
  it("branding + asset round trip through table and bucket", async () => {
    const db = fakeSupabase({});
    const store = new SupabaseBrandingStore(db);
    await store.saveBranding({ passId: "p1", title: "Acme Website", operatorName: "Proper Selects", brandColor: "#1B2A4A" });
    const b = await store.getBranding("p1");
    expect(b?.brandColor).toBe("#1B2A4A");
    expect(b?.logoAssetId).toBeUndefined();

    const bytes = Buffer.from("89504e470d0a1a0a", "hex");
    await store.saveAsset({ id: "asset1", contentType: "image/png", bytes });
    const asset = await store.getAsset("asset1");
    expect(asset?.contentType).toBe("image/png");
    expect(asset?.bytes.equals(bytes)).toBe(true);
    expect(await store.getAsset("missing")).toBeNull();
  });
});
