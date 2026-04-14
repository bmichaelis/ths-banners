import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext/browser";
import type { Env } from "./types";

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
    download_url: string;
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const { banner_key, printer_email, cc_email, sponsor_name, download_url } = body;

  if (!banner_key || !printer_email || !cc_email || !sponsor_name || !download_url) {
    return new Response("Missing required fields", { status: 400 });
  }

  const msg = createMimeMessage();
  msg.setSender({ addr: env.FROM_EMAIL });
  msg.setRecipient(printer_email);
  msg.setCc(cc_email);
  msg.setSubject(`Banner Ready: ${sponsor_name}`);
  msg.addMessage({
    contentType: "text/plain",
    data: `The banner PDF for ${sponsor_name} is ready for download.\n\nDownload link (expires in 7 days):\n${download_url}\n`,
  });

  const rawEmail = msg.asRaw();
  if (!rawEmail) {
    return new Response("MIME construction failed", { status: 500 });
  }

  const emailMessage = new EmailMessage(env.FROM_EMAIL, printer_email, rawEmail);
  try {
    await env.SEND_EMAIL.send(emailMessage);
    const ccMessage = new EmailMessage(env.FROM_EMAIL, cc_email, rawEmail);
    await env.SEND_EMAIL.send(ccMessage);
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return new Response(`Email send failed: ${errMsg}`, { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
