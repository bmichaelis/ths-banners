import { describe, it, expect, vi } from "vitest";
import { handleSendBanner } from "../src/email-outbound";
import type { Env } from "../src/types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    R2: {
      get: vi.fn().mockResolvedValue({
        arrayBuffer: vi.fn().mockResolvedValue(new ArrayBuffer(8)),
      }),
    } as unknown as R2Bucket,
    SEND_EMAIL: {
      send: vi.fn().mockResolvedValue(undefined),
    } as unknown as SendEmail,
    FROM_EMAIL: "twolfbanners@kindacoach.com",
    API_TOKEN: "secret-token",
    PRINTER_EMAIL: "printer@example.com",
    CC_EMAIL: "cc@example.com",
    ...overrides,
  };
}

function makeRequest(body: object, token = "secret-token"): Request {
  return new Request("https://worker.example.com/send-banner", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

describe("handleSendBanner", () => {
  it("returns 401 for missing or wrong token", async () => {
    const env = makeEnv();
    const req = makeRequest({ banner_key: "done/x.pdf" }, "wrong-token");
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(401);
    expect(env.SEND_EMAIL.send).not.toHaveBeenCalled();
  });

  it("returns 404 when banner_key not found in R2", async () => {
    const env = makeEnv({
      R2: { get: vi.fn().mockResolvedValue(null) } as unknown as R2Bucket,
    });
    const req = makeRequest({
      banner_key: "done/missing.pdf",
      printer_email: "p@example.com",
      cc_email: "cc@example.com",
      sponsor_name: "acme",
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(404);
  });

  it("sends email and returns 200 on success", async () => {
    const env = makeEnv();
    const req = makeRequest({
      banner_key: "done/acme-banner.pdf",
      printer_email: "printer@example.com",
      cc_email: "cc@example.com",
      sponsor_name: "acme",
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(200);
    expect(env.SEND_EMAIL.send).toHaveBeenCalledTimes(2);
  });

  it("returns 400 for invalid JSON body", async () => {
    const env = makeEnv();
    const req = new Request("https://worker.example.com/send-banner", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token",
      },
      body: "not-json",
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 400 when required fields are missing", async () => {
    const env = makeEnv();
    const req = makeRequest({ banner_key: "done/x.pdf" }); // missing printer_email, cc_email, sponsor_name
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 401 when Authorization header is absent", async () => {
    const env = makeEnv();
    const req = new Request("https://worker.example.com/send-banner", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ banner_key: "done/x.pdf" }),
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(401);
  });

  it("returns 500 when SEND_EMAIL.send throws", async () => {
    const env = makeEnv({
      SEND_EMAIL: {
        send: vi.fn().mockRejectedValue(new Error("destination not allowed")),
      } as unknown as SendEmail,
    });
    const req = makeRequest({
      banner_key: "done/acme-banner.pdf",
      printer_email: "printer@example.com",
      cc_email: "cc@example.com",
      sponsor_name: "acme",
    });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("destination not allowed");
  });
});
