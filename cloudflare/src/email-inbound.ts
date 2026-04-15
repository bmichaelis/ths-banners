import PostalMime from "postal-mime";
import type { Env } from "./types";

const ALLOWED_TYPES = ["image/png", "image/jpeg"];

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "-").toLowerCase();
}

export async function handleInboundEmail(
  message: ForwardableEmailMessage,
  env: Env
): Promise<void> {
  const parser = new PostalMime();
  const rawData = await new Response(message.raw).arrayBuffer();
  const email = await parser.parse(rawData);

  const senderEmail = email.from?.address ?? "";
  let savedCount = 0;

  for (const attachment of email.attachments) {
    const mimeType = attachment.mimeType?.toLowerCase() ?? "";
    if (!ALLOWED_TYPES.includes(mimeType)) continue;
    if ((attachment.content as ArrayBuffer).byteLength === 0) continue;

    const safeFilename = sanitizeFilename(
      attachment.filename ?? `logo.${mimeType.split("/")[1]}`
    );
    const uuid = crypto.randomUUID();
    const key = `pending/${uuid}-${safeFilename}`;

    await env.R2.put(key, attachment.content, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { senderemail: senderEmail },
    });
    savedCount++;
  }

  if (savedCount > 0 && env.GITHUB_DISPATCH_TOKEN) {
    try {
      await fetch(
        "https://api.github.com/repos/bmichaelis/ths-banners/dispatches",
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github.v3+json",
            Authorization: `Bearer ${env.GITHUB_DISPATCH_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ event_type: "banner-pending" }),
        }
      );
    } catch {
      console.error("Failed to trigger GitHub Actions workflow");
    }
  }
}
