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

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: [printer_email],
      cc: [cc_email],
      subject: `Banner Ready: ${sponsor_name}`,
      text: `The banner PDF for ${sponsor_name} is ready for download.\n\nDownload link (expires in 7 days):\n${download_url}\n`,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return new Response(`Email send failed: ${errText.slice(0, 500)}`, { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
