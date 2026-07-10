import { describe, expect, it } from "vitest";
import { buildPassSpec, type PassBranding, type PassContent } from "../src/passdesign.js";
import { createWalletWalletAdapter } from "../src/walletwallet.js";
import type { Pass } from "../src/types.js";

const branding: PassBranding = {
  title: "Acme Website",
  operatorName: "Proper Selects",
  brandColor: "#1B2A4A",
};

const content: PassContent = {
  phase: "In Review",
  rag: "yellow",
  statusText: "The homepage has moved to review and is awaiting final copy.",
  nextMilestone: "Launch",
  lastDeliverable: "Twilio account created",
  lastUpdatedISO: "2026-07-07T12:00:00Z",
  link: { label: "Review & approve", url: "https://statuspass.ai/l/tok123" },
};
const PHASES = ["Discovery", "Design", "Build", "In Review", "Delivered"];

describe("pass templates — design invariants", () => {
  it("client-delivery: field-tested layout — focus, calm status, progress, deliverable", () => {
    const spec = buildPassSpec("client-delivery", branding, content, PHASES);
    expect(spec.logoText).toBe("StatusPass");            // product brand top-left
    expect(spec.primaryFields[0].label).toBe("CURRENT FOCUS");
    expect(spec.primaryFields[0].value).toBe("IN REVIEW");
    expect(spec.backgroundColor).toBe("#1B2A4A");        // client brand color, steady
    // status vocabulary stays calm for clients even on yellow
    expect(spec.secondaryFields.find((f) => f.key === "status")?.value).toBe("IN PROGRESS");
    // derived progress: In Review = index 3 of 0..4 → 75%
    expect(spec.secondaryFields.find((f) => f.key === "progress")?.value).toBe("75% COMPLETED");
    expect(spec.auxiliaryFields.find((f) => f.key === "lastDeliverable")?.value).toBe("TWILIO ACCOUNT CREATED");
    expect(spec.thumbnailUrl).toBe(branding.logoUrl);    // client logo on the face
  });

  it("client passes read ON TRACK ✅ when healthy; internal passes escalate", () => {
    const calm = buildPassSpec("client-delivery", branding, { ...content, rag: null }, PHASES);
    expect(calm.secondaryFields.find((f) => f.key === "status")?.value).toContain("ON TRACK");
    const internal = buildPassSpec("internal-program", branding, { ...content, rag: "red" });
    expect(internal.secondaryFields.find((f) => f.key === "status")?.value).toContain("BLOCKED");
    expect(internal.backgroundColor).not.toBe("#1B2A4A"); // RAG tint, not brand
  });

  it("the QR on the pass face carries the context link", () => {
    const spec = buildPassSpec("client-delivery", branding, content, PHASES);
    expect(spec.barcode?.format).toBe("PKBarcodeFormatQR");
    expect(spec.barcode?.message).toBe("https://statuspass.ai/l/tok123");
    const noLink = buildPassSpec("client-delivery", branding, { ...content, link: null }, PHASES);
    expect(noLink.barcode).toBeUndefined();
  });

  it("the client-safe sentence rides the back field with %@ changeMessage — one banner only", () => {
    const spec = buildPassSpec("client-delivery", branding, content, PHASES);
    const status = spec.backFields.find((f) => f.key === "statusDetail");
    expect(status?.value).toBe(content.statusText);
    expect(status?.changeMessage).toBe("%@");
    const all = [...spec.headerFields, ...spec.primaryFields, ...spec.secondaryFields,
                 ...spec.auxiliaryFields, ...spec.backFields];
    expect(all.filter((f) => f.changeMessage)).toHaveLength(1);
  });

  it("tokenized link lands on the back with its phase-aware label", () => {
    const spec = buildPassSpec("client-delivery", branding, content, PHASES);
    const link = spec.backFields.find((f) => f.key === "primaryLink");
    expect(link?.label).toBe("Review & approve");
    expect(link?.value).toContain("/l/");
  });
});

describe("WalletWallet adapter", () => {
  const pass: Pass = {
    id: "p1", accountId: "a1", profile: "client-delivery", recipientLabel: "Acme — CEO",
    boardId: "b1", currentPhase: "Build", lastUpdatedAt: new Date().toISOString(), overrides: {},
  };

  function mockVendor() {
    const calls: Array<{ method: string; path: string; body: any; auth: string | null }> = [];
    const fetchImpl = (async (url: any, init: any) => {
      const path = String(url).replace("https://api.walletwallet.dev", "");
      calls.push({ method: init.method, path, body: JSON.parse(init.body), auth: init.headers.authorization });
      return new Response(
        JSON.stringify({ serialNumber: "WW-123", googleSaveUrl: "https://pay.google.com/save/x",
                         applePass: "base64", shareUrl: "https://walletwallet.dev/p/WW-123" }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    return { calls, fetchImpl };
  }

  function makeAdapter(vendor: ReturnType<typeof mockVendor>, serial: string | null) {
    const saved: string[] = [];
    const adapter = createWalletWalletAdapter({
      apiKey: "ww_live_test",
      fetchImpl: vendor.fetchImpl,
      getPassMeta: async () => ({ serial, branding, nextMilestone: "Launch" }),
      saveSerial: async (_id, s) => { saved.push(s); },
    });
    return { adapter, saved };
  }

  it("issues a pass: POST, persists serial, returns hosted add URL", async () => {
    const vendor = mockVendor();
    const { adapter, saved } = makeAdapter(vendor, null);
    const result = await adapter.issuePass(pass, content);
    expect(vendor.calls[0]).toMatchObject({ method: "POST", path: "/api/passes", auth: "Bearer ww_live_test" });
    expect(saved).toEqual(["WW-123"]);
    expect(result.addUrl).toBe("https://walletwallet.dev/p/WW-123"); // shareUrl from response
    // verified wire shape
    const body = vendor.calls[0].body;
    expect(body.barcodeFormat).toBe("QR");
    expect(typeof body.barcodeValue).toBe("string");
    expect(body.color).toBeDefined();                 // hex, not backgroundColor
    expect(body.backgroundColor).toBeUndefined();
    expect(body.auxiliaryFields).toBeUndefined();     // folded into secondary
    expect(body.secondaryFields.some((f: any) => f.label === "LAST DELIVERABLE")).toBe(true);
    expect(body.primaryFields[0]).not.toHaveProperty("key"); // wire fields are {label,value,changeMessage?}
    expect(body.sharingProhibited).toBe(true);
  });

  it("pushUpdate: PUTs the full new spec to the serial", async () => {
    const vendor = mockVendor();
    const { adapter } = makeAdapter(vendor, "WW-123");
    await adapter.pushUpdate(pass, {
      phase: "In Review", rag: null,
      text: "The homepage has moved to review and is awaiting final copy.",
      link: { label: "Review & approve", url: "https://statuspass.ai/l/tok123" },
    });
    const call = vendor.calls[0];
    expect(call).toMatchObject({ method: "PUT", path: "/api/passes/WW-123" });
    expect(call.body.primaryFields[0].value).toBe("IN REVIEW");
    const detail = call.body.backFields.find((f: any) => f.value.includes("awaiting final copy"));
    expect(detail.changeMessage).toBe("%@"); // the lock-screen banner mechanism, on the wire
  });

  it("refuses to update an unissued pass", async () => {
    const vendor = mockVendor();
    const { adapter } = makeAdapter(vendor, null);
    await expect(
      adapter.pushUpdate(pass, { phase: "Build", rag: null, text: "x", link: null }),
    ).rejects.toThrow(/no vendor serial/);
  });
});
