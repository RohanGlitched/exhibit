import "server-only";

/**
 * Thin REST client for the PayPal sandbox: one cached OAuth token, JSON and multipart calls, retries on
 * 429/5xx, and every PayPal error turned into one plain sentence (PayPalError.message) plus its debug id.
 */
export const PAYPAL_BASE = process.env.PAYPAL_BASE || "https://api-m.sandbox.paypal.com";

export const paypalReady = () => Boolean(process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET);

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly issue?: string,
    readonly debugId?: string,
  ) {
    super(message);
  }
}

let token: { value: string; expires: number; scope: string } | null = null;

export async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expires - 60_000) return token.value;
  if (!paypalReady()) throw new PayPalError("PayPal sandbox keys are not set on the server.", 500, "NO_KEYS");
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${PAYPAL_BASE}/v1/oauth2/token`, {
    method: "POST",
    headers: { authorization: `Basic ${basic}`, "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; scope?: string; error_description?: string };
  if (!res.ok || !body.access_token) {
    throw new PayPalError(`PayPal refused the sandbox keys (${body.error_description ?? res.status}).`, res.status, "AUTH");
  }
  token = { value: body.access_token, expires: Date.now() + (body.expires_in ?? 3000) * 1000, scope: body.scope ?? "" };
  return token.value;
}

/** Scopes on the current token, for the health check. */
export async function tokenScopes(): Promise<string[]> {
  await accessToken();
  return (token?.scope ?? "").split(" ").filter(Boolean);
}

interface PayPalErrorBody {
  name?: string;
  message?: string;
  debug_id?: string;
  details?: { issue?: string; description?: string; field?: string }[];
  error_description?: string;
}

const PLAIN: Record<string, string> = {
  NOT_AUTHORIZED: "This sandbox app isn't allowed to do that. Check the app's features in the PayPal dashboard.",
  PERMISSION_DENIED: "This sandbox app isn't allowed to do that. Check the app's features in the PayPal dashboard.",
  RESOURCE_NOT_FOUND: "PayPal has no record with that id.",
  INVALID_RESOURCE_ID: "PayPal has no record with that id.",
  UNPROCESSABLE_ENTITY: "PayPal won't take that action on this case right now.",
  RATE_LIMIT_REACHED: "PayPal is rate-limiting the sandbox. Try again in a minute.",
  CANNOT_PROCESS_REFUNDS: "PayPal can't refund this payment.",
  NOT_ENABLED_FOR_CARD_PROCESSING: "Card payments aren't enabled on this sandbox app.",
};

function plainError(status: number, body: PayPalErrorBody, what: string): PayPalError {
  const detail = body.details?.[0];
  const issue = detail?.issue ?? body.name;
  const known = (issue && PLAIN[issue]) || (body.name && PLAIN[body.name]);
  const fields = (body.details ?? []).map((d) => [d.field, d.issue].filter(Boolean).join(": ")).filter(Boolean).join("; ");
  if (body.details?.length && status !== 404) console.error(`PayPal ${what} ${status}`, JSON.stringify(body.details), body.debug_id);
  const said = known ?? detail?.description ?? (fields ? `${body.message ?? "invalid request"} (${fields})` : undefined) ?? body.message ?? body.error_description ?? `HTTP ${status}`;
  return new PayPalError(known ? said : `${what} failed: ${said}`, status, issue, body.debug_id);
}

export interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  form?: FormData;
  headers?: Record<string, string>;
  requestId?: string;
  what?: string;
  timeoutMs?: number;
}

export async function paypal<T = unknown>(path: string, opts: CallOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body || opts.form ? "POST" : "GET");
  const what = opts.what ?? `${method} ${path.split("?")[0]}`;
  for (let attempt = 0; ; attempt++) {
    const headers: Record<string, string> = {
      authorization: `Bearer ${await accessToken()}`,
      accept: "application/json",
      ...(opts.requestId ? { "paypal-request-id": opts.requestId } : {}),
      ...opts.headers,
    };
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(opts.body);
    }
    let res: Response;
    try {
      res = await fetch(`${PAYPAL_BASE}${path}`, {
        method,
        headers,
        body: payload,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 20_000),
        cache: "no-store",
      });
    } catch (e) {
      if (attempt < 2) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw new PayPalError(`PayPal didn't answer (${(e as Error).name}). Try again.`, 504, "TIMEOUT");
    }
    if (res.status === 401 && attempt === 0) {
      token = null;
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
      continue;
    }
    const text = await res.text();
    const json = text ? (JSON.parse(text) as unknown) : {};
    if (!res.ok) throw plainError(res.status, json as PayPalErrorBody, what);
    return json as T;
  }
}

/** Multipart body with a JSON part named `input`, the shape the Disputes API expects. */
export function inputForm(input: unknown, files: { field: string; name: string; type: string; data: Uint8Array }[] = []): FormData {
  const form = new FormData();
  form.append("input", new Blob([JSON.stringify(input)], { type: "application/json" }));
  for (const f of files) form.append(f.field, new Blob([f.data as BlobPart], { type: f.type }), f.name);
  return form;
}
