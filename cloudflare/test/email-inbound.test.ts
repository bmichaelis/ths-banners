import { describe, it, expect, vi } from "vitest";
import { handleInboundEmail } from "../src/email-inbound";
import type { Env } from "../src/types";

// Minimal stub for ForwardableEmailMessage
function makeMessage(rawEmail: string): ForwardableEmailMessage {
  const encoder = new TextEncoder();
  return {
    raw: new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(rawEmail));
        controller.close();
      },
    }),
    from: "sender@example.com",
    to: "twolfbanners@kindacoach.com",
    headers: new Headers(),
    forward: vi.fn(),
    reply: vi.fn(),
    reject: vi.fn(),
    setReject: vi.fn(),
  } as unknown as ForwardableEmailMessage;
}

// Minimal raw MIME email with a PNG attachment
const RAW_WITH_PNG = [
  "MIME-Version: 1.0",
  "From: sponsor@example.com",
  "To: twolfbanners@kindacoach.com",
  "Subject: Logo",
  'Content-Type: multipart/mixed; boundary="boundary"',
  "",
  "--boundary",
  "Content-Type: text/plain",
  "",
  "Here is our logo.",
  "--boundary",
  "Content-Type: image/png",
  'Content-Disposition: attachment; filename="acme-logo.png"',
  "Content-Transfer-Encoding: base64",
  "",
  "iVBORw0KGgo=",
  "--boundary--",
].join("\r\n");

const RAW_NO_IMAGE = [
  "MIME-Version: 1.0",
  "From: sponsor@example.com",
  "To: twolfbanners@kindacoach.com",
  "Subject: No attachment",
  "Content-Type: text/plain",
  "",
  "No attachment here.",
].join("\r\n");

describe("handleInboundEmail", () => {
  it("saves PNG attachment to R2 pending/", async () => {
    const mockR2 = { put: vi.fn().mockResolvedValue(undefined) };
    const env = { R2: mockR2 } as unknown as Env;

    await handleInboundEmail(makeMessage(RAW_WITH_PNG), env);

    expect(mockR2.put).toHaveBeenCalledOnce();
    const [key, , opts] = mockR2.put.mock.calls[0];
    expect(key).toMatch(/^pending\/[0-9a-f-]+-acme-logo\.png$/);
    expect(opts.httpMetadata.contentType).toBe("image/png");
  });

  it("ignores emails with no image attachments", async () => {
    const mockR2 = { put: vi.fn() };
    const env = { R2: mockR2 } as unknown as Env;

    await handleInboundEmail(makeMessage(RAW_NO_IMAGE), env);

    expect(mockR2.put).not.toHaveBeenCalled();
  });
});
