// Provide EmailMessage global for test environment.
// In the real Workers runtime this is a built-in; tests don't have a
// send_email binding so we define a minimal stub here.
if (typeof EmailMessage === "undefined") {
  (globalThis as unknown as Record<string, unknown>).EmailMessage = class EmailMessage {
    constructor(
      public from: string,
      public to: string,
      public raw: string | ReadableStream
    ) {}
  };
}
