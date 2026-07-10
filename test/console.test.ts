import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/app.js";
import { InMemoryStores } from "../src/cadence.js";
import type { Pass } from "../src/types.js";

const BASE = "http://localhost:8097";
const KEY = "console-key";
let stop: () => void;
let stores: InMemoryStores;

const api = (path: string, opts: RequestInit = {}) =>
  fetch(BASE + path, { ...opts, headers: { "content-type": "application/json", authorization: `Bearer ${KEY}`, ...(opts.headers as any) } });

beforeAll(() => {
  stores = new InMemoryStores();
  stores.accounts.set("default", { id: "default", name: "Test Agency", defaults: {}, internalNames: [], tier: "studio" });
  const pass: Pass = {
    id: "p-existing", accountId: "default", profile: "client-delivery",
    recipientLabel: "Acme — CEO", boardId: "b1", currentPhase: "Build",
    lastUpdatedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(), overrides: {},
  };
  stores.passes.set(pass.id, pass);
  stores.cardIndex.set("b1:card1", pass.id);
  const s = startServer({
    config: {
      port: 8097, publicBaseUrl: BASE, trelloApiSecret: "t", jiraWebhookSecret: "jira-secret", linkTokenSecret: "link-secret",
      routing: { routine: "dev", frontier: "dev" }, cadenceIntervalMs: 3_600_000,
      consoleToken: KEY, defaultAccountId: "default", stripeWebhookSecret: "", emailFrom: "test@x",
    },
    stores,
  });
  stop = s.stop;
});
afterAll(() => stop());

describe("console", () => {
  it("serves the console page with the first-run onboarding", async () => {
    const res = await fetch(BASE + "/console?key=" + KEY);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("StatusPass");
    expect(html).toContain("Add Client");
    expect(html).toContain("showClients");
    expect(html).toContain("showBoard");
    expect(html).toContain("sp_key");
  });

  it("rejects API calls without the console key", async () => {
    const res = await fetch(BASE + "/api/passes");
    expect(res.status).toBe(401);
  });

  it("lists passes with staleness wear state", async () => {
    const res = await api("/api/passes");
    expect(res.status).toBe(200);
    const { passes } = await res.json() as any;
    const p = passes.find((x: any) => x.id === "p-existing");
    expect(p.quietDays).toBeGreaterThanOrEqual(8);
    expect(p.currentPhase).toBe("Build");
  });

  it("issues a pass: creates, indexes the card, returns a branding link", async () => {
    const res = await api("/api/passes", {
      method: "POST",
      body: JSON.stringify({ recipientLabel: "Globex — CFO", profile: "internal-program", boardId: "b2", cardId: "c9" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.pass.currentPhase).toBe("Planning"); // first phase of internal profile
    expect(body.brandingUrl).toContain("/brand/");
    expect(stores.cardIndex.get("b2:c9")).toBe(body.pass.id);
    // the branding link actually opens
    const page = await fetch(body.brandingUrl);
    expect(page.status).toBe(200);
  });

  it("rejects issuance with missing fields", async () => {
    const res = await api("/api/passes", { method: "POST", body: JSON.stringify({ recipientLabel: "X" }) });
    expect(res.status).toBe(400);
  });

  it("shows pass detail with resolved rules", async () => {
    const res = await api("/api/passes/p-existing");
    const body = await res.json() as any;
    expect(body.resolvedRules.significance.notifyOn).toContain("manual_update");
    expect(body.resolvedRules.voice.tone).toBe("professional");
  });

  it("manual update runs the full pipeline and ships", async () => {
    const res = await api("/api/passes/p-existing/update", {
      method: "POST",
      body: JSON.stringify({ note: "finished homepage build, moving to review", phase: "Review" }),
    });
    const { outcome } = await res.json() as any;
    expect(outcome.action).toBe("shipped");
    expect(stores.passes.get("p-existing")!.currentPhase).toBe("In Review"); // mapped via rules
  });

  it("edits and persists the column mapping", async () => {
    const put = await api("/api/mapping", {
      method: "PUT",
      body: JSON.stringify({ columnToPhase: { "Staging": "In Review", "Shipped": "Delivered" } }),
    });
    expect(put.status).toBe(200);
    const get = await api("/api/mapping");
    const { columnToPhase, accountOverrides } = await get.json() as any;
    expect(accountOverrides["Staging"]).toBe("In Review");
    expect(columnToPhase["Review"]).toBe("In Review"); // defaults still merged in
  });
});
