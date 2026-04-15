export interface Env {
  R2: R2Bucket;
  RESEND_API_KEY: string;
  FROM_EMAIL: string;
  API_TOKEN: string;
  PRINTER_EMAIL: string;
  CC_EMAIL: string;
  GITHUB_DISPATCH_TOKEN?: string;
}
