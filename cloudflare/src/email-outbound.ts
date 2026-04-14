import { createMimeMessage } from "mimetext/browser";
import type { Env } from "./types";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function handleSendBanner(
  request: Request,
  env: Env
): Promise<Response> {
  const auth = request.headers.get("Authorization");
  if (auth !== `Bearer ${env.API_TOKEN}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: {
    banner_key: string;
    printer_email: string;
    cc_email: string;
    sponsor_name: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { banner_key, printer_email, cc_email, sponsor_name } = body;

  const obj = await env.R2.get(banner_key);
  if (!obj) {
    return new Response(`Banner not found: ${banner_key}`, { status: 404 });
  }
  const pdfBytes = await obj.arrayBuffer();

  const msg = createMimeMessage();
  msg.setSender({ addr: env.FROM_EMAIL });
  msg.setRecipient(printer_email);
  msg.setCc(cc_email);
  msg.setSubject(`Banner Ready: ${sponsor_name}`);
  msg.addMessage({
    contentType: "text/plain",
    data: `The banner PDF for ${sponsor_name} is attached.`,
  });
  msg.addAttachment({
    filename: `${sponsor_name}-banner.pdf`,
    contentType: "application/pdf",
    data: arrayBufferToBase64(pdfBytes),
    encoding: "base64",
  });

  const rawEmail = msg.asRaw();
  const emailMessage = new EmailMessage(env.FROM_EMAIL, printer_email, rawEmail);
  await env.SEND_EMAIL.send(emailMessage);

  return new Response("OK", { status: 200 });
}
