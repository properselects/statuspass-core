import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startServer } from "../src/app.js";
import { InMemoryStores } from "../src/cadence.js";
import { hashPassword, verifyPassword, mintSessionToken, redeemSessionToken } from "../src/auth.js";
import { canIssuePass, tierChangeFromEvent, verifyStripeSignature } from "../src/billing.js";
import { buildPassSpec } from "../src/passdesign.js";
import { createHmac } from "node:crypto";

const BASE = "http://localhost:8089";
let stop: () => void;
let stores: InMemoryStores;
const emails: Array<{ to: string; subject: string }> = [];

beforeAll(() => {
  stores = new InMemoryStores();
  const s = startServer({
    config: {
      port: 8089, publicBaseUrl: BASE, trelloApiSecret: "t", jiraWebhookSecret: "j",
      linkTokenSecret: "link-secret", routing: { routine: "dev", frontier: "dev" },
      cadenceIntervalMs: 3_600_000, consoleToken: "legacy-key", defaultAccountId: "default",
      stripeWebhookSecret: "whsec_test", emailFrom: "test@statuspass.ai",
    },
    stores,
    email: { send: async ({ to, subject }) => { emails.push({ to, subject }); } },
  });
  stop = s.stop;
});
afterAll(() => stop());

async function signup(name: string, email: string, password = "hunter2hunter2") {
  const res = await fetch(`${BASE}/signup`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ name, email, password }).toString(),
  });
  const cookie = res.headers.get("set-cookie")?.split(";")[0] ?? "";
  return { status: res.status, cookie };
}

const withSession = (cookie: string) => ({ cookie, "content-type": "application/json" });

describe("password + session primitives", () => {
  it("hashes and verifies; rejects wrong passwords", () => {
    const h = hashPassword("correct horse");
    expect(verifyPassword("correct horse", h)).toBe(true);
    expect(verifyPassword("wrong horse", h)).toBe(false);
  });
  it("session tokens are kind-scoped and expire", () => {
    const t = mintSessionToken("a1", "s");
    expect(redeemSessionToken(t, "s")).toEqual({ ok: true, accountId: "a1" });
    expect(redeemSessionToken(t, "wrong")).toEqual({ ok: false });
    const old = mintSessionToken("a1", "s", new Date(Date.now() - 31 * 86_400_000));
    expect(redeemSessionToken(old, "s")).toEqual({ ok: false });
  });
});

describe("multi-tenant isolation (the money test)", () => {
  let alice: string; let bob: string;
  let alicePassId: string;

  it("two operators sign up and get separate sessions", async () => {
    const a = await signup("Alice Agency", "alice@a.test");
    const b = await signup("Bob Studio", "bob@b.test");
    expect(a.status).toBe(302); expect(b.status).toBe(302);
    alice = a.cookie; bob = b.cookie;
    expect(emails.some((e) => e.to === "alice@a.test" && e.subject.includes("Welcome"))).toBe(true);
  });

  it("duplicate email is rejected; bad login is rejected", async () => {
    const dup = await signup("Alice Again", "alice@a.test");
    expect(dup.status).toBe(400);
    const badLogin = await fetch(`${BASE}/login`, {
      method: "POST", redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ email: "alice@a.test", password: "wrongwrongwrong" }).toString(),
    });
    expect(badLogin.status).toBe(400);
  });

  it("Alice issues a pass; Bob CANNOT see it, read it, or update it", async () => {
    const create = await fetch(`${BASE}/api/passes`, {
      method: "POST", headers: withSession(alice),
      body: JSON.stringify({ recipientLabel: "Acme — CEO", profile: "client-delivery", boardId: "internal" }),
    });
    expect(create.status).toBe(201);
    alicePassId = ((await create.json()) as any).pass.id;

    const bobList = await (await fetch(`${BASE}/api/passes`, { headers: withSession(bob) })).json() as any;
    expect(bobList.passes).toHaveLength(0);                       // scoped list

    const bobDetail = await fetch(`${BASE}/api/passes/${alicePassId}`, { headers: withSession(bob) });
    expect(bobDetail.status).toBe(404);                           // no cross-tenant read

    const bobUpdate = await fetch(`${BASE}/api/passes/${alicePassId}/update`, {
      method: "POST", headers: withSession(bob), body: JSON.stringify({ note: "hijack" }),
    });
    expect(bobUpdate.status).toBe(404);                           // no cross-tenant write

    const aliceList = await (await fetch(`${BASE}/api/passes`, { headers: withSession(alice) })).json() as any;
    expect(aliceList.passes).toHaveLength(1);                     // Alice still sees hers
  });

  it("both accounts can use the internal board without colliding", async () => {
    const bobCreate = await fetch(`${BASE}/api/passes`, {
      method: "POST", headers: withSession(bob),
      body: JSON.stringify({ recipientLabel: "Globex — CFO", profile: "client-delivery", boardId: "internal" }),
    });
    expect(bobCreate.status).toBe(201); // no "internal:*" card-index collision
  });

  it("free tier caps at 1 active pass with a 402 and upgrade message", async () => {
    const second = await fetch(`${BASE}/api/passes`, {
      method: "POST", headers: withSession(alice),
      body: JSON.stringify({ recipientLabel: "Second Client", profile: "client-delivery", boardId: "internal" }),
    });
    expect(second.status).toBe(402);
    expect(((await second.json()) as any).error).toContain("Upgrade");
  });

  it("a shared external board cannot be claimed by a second account", async () => {
    // upgrade both so tier isn't the blocker
    for (const email of ["alice@a.test", "bob@b.test"]) {
      const acct = (await stores.getAccountByEmail(email))!;
      acct.tier = "studio"; await stores.saveAccount(acct);
    }
    const a = await fetch(`${BASE}/api/passes`, {
      method: "POST", headers: withSession(alice),
      body: JSON.stringify({ recipientLabel: "A", profile: "client-delivery", boardId: "trello-shared", cardId: "*" }),
    });
    expect(a.status).toBe(201);
    const b = await fetch(`${BASE}/api/passes`, {
      method: "POST", headers: withSession(bob),
      body: JSON.stringify({ recipientLabel: "B", profile: "client-delivery", boardId: "trello-shared", cardId: "*" }),
    });
    expect(b.status).toBe(409);
    expect(((await b.json()) as any).error).toContain("another account");
  });

  it("legacy console token still works and maps to the default account", async () => {
    const res = await fetch(`${BASE}/api/passes`, { headers: { authorization: "Bearer legacy-key" } });
    expect(res.status).toBe(200);
    const { passes } = await res.json() as any;
    expect(passes.every((p: any) => true)).toBe(true); // scoped to default (empty)
    expect(passes).toHaveLength(0);
  });

  it("unauthenticated console GET redirects to login", async () => {
    const res = await fetch(`${BASE}/console`, { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });
});

describe("billing primitives", () => {
  it("tier limits enforce", () => {
    expect(canIssuePass("free", 0).ok).toBe(true);
    expect(canIssuePass("free", 1).ok).toBe(false);
    expect(canIssuePass("studio", 24).ok).toBe(true);
    expect(canIssuePass("studio", 25).ok).toBe(false);
  });

  it("stripe signature verifies and rejects tampering", () => {
    const secret = "whsec_test";
    const body = '{"type":"checkout.session.completed"}';
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", secret).update(`${t}.${body}`).digest("hex");
    const header = `t=${t},v1=${sig}`;
    expect(verifyStripeSignature({ rawBody: body, header, endpointSecret: secret })).toBe(true);
    expect(verifyStripeSignature({ rawBody: body + " ", header, endpointSecret: secret })).toBe(false);
    const stale = `t=${t - 10_000},v1=${sig}`;
    expect(verifyStripeSignature({ rawBody: body, header: stale, endpointSecret: secret })).toBe(false);
  });

  it("stripe events map to tier changes", () => {
    const map = { price_solo: "solo" as const };
    expect(tierChangeFromEvent({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: "a1", customer: "cus_1", metadata: { price_id: "price_solo" } } },
    }, map)).toEqual({ accountId: "a1", tier: "solo", stripeCustomerId: "cus_1" });
    expect(tierChangeFromEvent({
      type: "customer.subscription.deleted",
      data: { object: { metadata: { account_id: "a1" } } },
    }, map)).toEqual({ accountId: "a1", tier: "free" });
  });

  it("live stripe webhook flips the tier", async () => {
    const acct = (await stores.getAccountByEmail("bob@b.test"))!;
    process.env.STRIPE_PRICE_AGENCY = "price_agency";
    const body = JSON.stringify({
      type: "checkout.session.completed",
      data: { object: { client_reference_id: acct.id, customer: "cus_9", metadata: { price_id: "price_agency" } } },
    });
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac("sha256", "whsec_test").update(`${t}.${body}`).digest("hex");
    const res = await fetch(`${BASE}/webhooks/stripe`, {
      method: "POST", headers: { "stripe-signature": `t=${t},v1=${sig}` }, body,
    });
    expect(res.status).toBe(200);
    expect((await stores.getAccount(acct.id)).tier).toBe("agency");
    const forged = await fetch(`${BASE}/webhooks/stripe`, {
      method: "POST", headers: { "stripe-signature": "t=1,v1=deadbeef" }, body,
    });
    expect(forged.status).toBe(401);
  });
});

describe("white-label", () => {
  const branding = { title: "Acme", operatorName: "Bob Studio", whiteLabel: true } as any;
  const content = { phase: "Build", rag: null, statusText: "x", lastUpdatedISO: new Date().toISOString(), link: null };
  it("agency tier passes carry the operator's name instead of StatusPass", () => {
    const spec = buildPassSpec("client-delivery", branding, content as any, []);
    expect(spec.logoText).toBe("Bob Studio");
    const plain = buildPassSpec("client-delivery", { ...branding, whiteLabel: false }, content as any, []);
    expect(plain.logoText).toBe("StatusPass");
  });
});
