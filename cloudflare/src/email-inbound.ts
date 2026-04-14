import PostalMime from "postal-mime";
import type { Env } from "./types";

const ALLOWED_TYPES = ["image/png", "image/jpeg", "image/jpg"];

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

  for (const attachment of email.attachments ?? []) {
    const mimeType = attachment.mimeType?.toLowerCase() ?? "";
    if (!ALLOWED_TYPES.includes(mimeType)) continue;

    const safeFilename = sanitizeFilename(
      attachment.filename ?? `logo.${mimeType.split("/")[1]}`
    );
    const uuid = crypto.randomUUID();
    const key = `pending/${uuid}-${safeFilename}`;

    await env.R2.put(key, attachment.content, {
      httpMetadata: { contentType: mimeType },
    });
  }
}
