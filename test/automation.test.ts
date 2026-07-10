import { describe, expect, it } from "vitest";
import { startServer, type PassDeliveryAdapter } from "../src/app.js";
import { InMemoryStores } from "../src/cadence.js";
import { mintBrandingToken } from "../src/branding.js";
import { handleBoardEvent, type PipelineDeps } from "../src/pipeline.js";
import type { Account, ModelClient, Pass } from "../src/types.js";

describe("auto-issue on branding completion", () => {
  it("client finishes branding → same response carries the Add-to-Wallet URL", async () => {
    const stores = new InMemoryStores();
    stores.accounts.set("default", { id: "default", name: "Agency", defaults: {}, internalNames: [] });
    stores.passes.set("p1", {
      id: "p1", accountId: "default", profile: "client-delivery", recipientLabel: "Acme — CEO",
      boardId: "internal", currentPhase: "Discovery", lastUpdatedAt: new Date().toISOString(), overrides: {},
    });
    const issued: string[] = [];
    const delivery: PassDeliveryAdapter = {
      pushUpdate: async () => {},
      issuePass: async (pass) => {
        issued.push(pass.id);
        return { serial: "WW-77", addUrl: "https://www.walletwallet.dev/p/WW-77", googleSaveUrl: "https://g/save" };
      },
    };
    const { stop } = startServer({
      config: {
        port: 8094, publicBaseUrl: "http://localhost:8094",
        trelloApiSecret: "t", jiraWebhookSecret: "j", linkTokenSecret: "s",
        routing: { routine: "dev", frontier: "dev" }, cadenceIntervalMs: 3_600_000,
        consoleToken: "k", defaultAccountId: "default", stripeWebhookSecret: "", emailFrom: "test@x",
      },
      stores, delivery,
    });
    try {
      const token = mintBrandingToken("p1", 72, "s");
      const res = await fetch(`http://localhost:8094/brand/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Acme Website", brandColor: "#1B2A4A" }),
      });
      const body = await res.json() as any;
      expect(body.addUrl).toBe("https://www.walletwallet.dev/p/WW-77");
      expect(issued).toEqual(["p1"]);
      expect(stores.passes.get("p1")!.addUrl).toBe("https://www.walletwallet.dev/p/WW-77");

      // Re-submitting doesn't double-issue — the stored addUrl is reused
      const again = await fetch(`http://localhost:8094/brand/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Acme Website v2" }),
      });
      expect(((await again.json()) as any).addUrl).toBe("https://www.walletwallet.dev/p/WW-77");
      expect(issued).toHaveLength(1);
    } finally {
      stop();
    }
  });

  it("without a vendor, branding still succeeds and promises a link", async () => {
    const stores = new InMemoryStores();
    stores.accounts.set("default", { id: "default", name: "A", defaults: {}, internalNames: [] });
    stores.passes.set("p1", {
      id: "p1", accountId: "default", profile: "client-delivery", recipientLabel: "X",
      boardId: "internal", currentPhase: "Discovery", lastUpdatedAt: new Date().toISOString(), overrides: {},
    });
    const { stop } = startServer({
      config: {
        port: 8093, publicBaseUrl: "http://localhost:8093",
        trelloApiSecret: "t", jiraWebhookSecret: "j", linkTokenSecret: "s",
        routing: { routine: "dev", frontier: "dev" }, cadenceIntervalMs: 3_600_000,
        consoleToken: "k", defaultAccountId: "default", stripeWebhookSecret: "", emailFrom: "test@x",
      },
      stores, // default consoleDeliveryAdapter — no issuePass
    });
    try {
      const token = mintBrandingToken("p1", 72, "s");
      const res = await fetch(`http://localhost:8093/brand/${token}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "X" }),
      });
      const body = await res.json() as any;
      expect(body.ok).toBe(true);
      expect(body.addUrl).toBeUndefined();
    } finally {
      stop();
    }
  });
});

describe("unmapped column nudge", () => {
  it("notifies the operator instead of silently stalling", async () => {
    const account: Account = { id: "a1", name: "Agency", defaults: {}, internalNames: [] };
    const pass: Pass = {
      id: "p1", accountId: "a1", profile: "client-delivery", recipientLabel: "Acme — CEO",
      boardId: "b1", currentPhase: "Build", lastUpdatedAt: new Date().toISOString(), overrides: {},
    };
    const nudges: string[] = [];
    const okModel: ModelClient = {
      complete: async () => '{"text":"Update: still in build.","phase":"Build","rag":null}',
    };
    const deps: PipelineDeps = {
      getPassForBoardCard: async () => pass,
      getAccount: async () => account,
      getProfileConfig: async () => undefined,
      resolvePrimaryLink: async () => null,
      deliverPassUpdate: async () => {},
      touchPass: async () => {},
      notifyOperator: async (_id, msg) => { nudges.push(msg); },
    };
    const out = await handleBoardEvent(
      { type: "phase_change", boardId: "b1", cardId: "c1", cardTitle: "t",
        fromColumn: "Doing", toColumn: "Weird Custom Column", explicitDates: [] },
      deps, { client: okModel, routing: { routine: "m", frontier: "m" } },
    );
    expect(nudges[0]).toContain('"Weird Custom Column"');
    expect(nudges[0]).toContain("Mapping");
    expect(out.action).toBe("shipped"); // still ships at current phase rather than dying
  });
});
