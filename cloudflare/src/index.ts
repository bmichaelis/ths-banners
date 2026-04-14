import { handleInboundEmail } from "./email-inbound";
import { handleSendBanner } from "./email-outbound";
import type { Env } from "./types";

export default {
  async email(
    message: ForwardableEmailMessage,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<void> {
    await handleInboundEmail(message, env);
  },

  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext
  ): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/send-banner") {
      if (request.method === "POST") {
        return handleSendBanner(request, env);
      }
      return new Response("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
    }
    return new Response("Not Found", { status: 404 });
  },
};
