import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSendBanner } from "../src/email-outbound";
import type { Env } from "../src/types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    R2: {} as unknown as R2Bucket,
    RESEND_API_KEY: "re_test_key",
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

const fullBody = {
  banner_key: "done/acme-banner.pdf",
  printer_email: "printer@example.com",
  cc_email: "cc@example.com",
  sponsor_name: "acme",
  download_url: "https://r2.example.com/test.pdf",
  sender_email: "bob@example.com",
  email_body: "Custom email body with download link: https://r2.example.com/test.pdf",
};

describe("handleSendBanner", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "abc123" }), { status: 200 })
    ));
  });

  it("returns 401 for missing or wrong token", async () => {
    const env = makeEnv();
    const req = makeRequest({ banner_key: "done/x.pdf" }, "wrong-token");
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(401);
    expect(fetch).not.toHaveBeenCalled();
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
    const req = makeRequest({ banner_key: "done/x.pdf" });
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(400);
  });

  it("returns 500 when Resend API returns an error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ message: "Invalid API key" }), { status: 401 })
    ));
    const env = makeEnv();
    const req = makeRequest(fullBody);
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(500);
    expect(await res.text()).toContain("Invalid API key");
  });

  it("omits sender_email from CC when not provided and falls back to default body", async () => {
    const env = makeEnv();
    const { sender_email: _, email_body: __, ...bodyWithoutSender } = fullBody;
    const req = makeRequest(bodyWithoutSender);
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(200);
    const [, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const sentBody = JSON.parse(init.body);
    expect(sentBody.cc).toEqual(["cc@example.com"]);
    expect(sentBody.text).toContain("https://r2.example.com/test.pdf");
  });

  it("calls Resend API with correct payload and returns 200", async () => {
    const env = makeEnv();
    const req = makeRequest(fullBody);
    const res = await handleSendBanner(req, env);
    expect(res.status).toBe(200);
    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    const sentBody = JSON.parse(init.body);
    expect(sentBody.to).toEqual(["printer@example.com"]);
    expect(sentBody.cc).toEqual(["cc@example.com", "bob@example.com"]);
    expect(sentBody.subject).toBe("Banner Ready: acme");
    expect(sentBody.text).toBe("Custom email body with download link: https://r2.example.com/test.pdf");
  });
});
