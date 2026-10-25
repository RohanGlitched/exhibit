import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 in a few lines of node:crypto, for the one AWS service Exhibit calls (Bedrock Runtime). Copied from Lowtide, which also signs
 * Amazon S3 and Amazon Polly requests with it. No SDK: the whole AWS surface here is one JSON request, and keeping it this
 * small keeps the serverless bundle and the cold start small.
 *
 * Temporary credentials (a Lambda execution role, an assumed role) carry a session token: it is sent as
 * x-amz-security-token and signed like any other header.
 */
export type AwsCredentials = { accessKeyId: string; secretAccessKey: string; sessionToken?: string };

export interface SignInput {
  method: string;
  url: string | URL;
  service: string;
  region: string;
  body?: string | Uint8Array;
  /** Extra headers to send and sign (content-type, if-match, …). */
  headers?: Record<string, string>;
  now?: Date;
  /** Send x-amz-content-sha256 (S3 requires it; harmless elsewhere). Default true. */
  contentSha256?: boolean;
}

const sha256 = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
const hmac = (key: string | Buffer, s: string) => createHmac("sha256", key).update(s, "utf8").digest();
/** RFC 3986 encoding, which is what SigV4 wants (encodeURIComponent leaves !'()* alone). */
const rfc3986 = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export const amzDate = (now: Date) => now.toISOString().replace(/[:-]|\.\d{3}/g, "");

/**
 * Headers for one signed request: everything in `headers`, plus x-amz-date, x-amz-content-sha256, the session
 * token when there is one, and authorization. `host` is signed but not returned (fetch sets it).
 */
export function signRequest(input: SignInput, creds: AwsCredentials): Record<string, string> {
  const url = typeof input.url === "string" ? new URL(input.url) : input.url;
  const date = amzDate(input.now ?? new Date());
  const day = date.slice(0, 8);
  const payload = sha256(input.body ?? "");
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.headers ?? {})) headers[k.toLowerCase()] = String(v).trim().replace(/\s+/g, " ");
  headers.host = url.host;
  headers["x-amz-date"] = date;
  if (input.contentSha256 !== false) headers["x-amz-content-sha256"] = payload;
  if (creds.sessionToken) headers["x-amz-security-token"] = creds.sessionToken;
  const names = Object.keys(headers).sort();
  // S3 signs the path as sent; every other service encodes each segment once more.
  const path =
    input.service === "s3"
      ? url.pathname || "/"
      : (url.pathname || "/")
          .split("/")
          .map((seg) => rfc3986(decodeURIComponentSafe(seg)).replace(/%/g, "%25"))
          .join("/");
  const query = [...url.searchParams.entries()]
    .map(([k, v]) => [rfc3986(k), rfc3986(v)] as const)
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const canonical = [input.method.toUpperCase(), path, query, names.map((n) => `${n}:${headers[n]}\n`).join(""), names.join(";"), payload].join("\n");
  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", date, scope, sha256(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${creds.secretAccessKey}`, day), input.region), input.service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign, "utf8").digest("hex");
  const { host: _host, ...rest } = headers;
  return { ...rest, authorization: `AWS4-HMAC-SHA256 Credential=${creds.accessKeyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${signature}` };
}

/** Path segments arrive percent-encoded from URL; decode before re-encoding so "%3A" isn't encoded three times. */
function decodeURIComponentSafe(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}
