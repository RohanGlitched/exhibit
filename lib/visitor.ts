import "server-only";
import { cookies, headers } from "next/headers";

/** A short random id per browser, so a visitor's own cases can be told apart on the shared sandbox desk. */
export async function visitorId(create = false): Promise<string | null> {
  const jar = await cookies();
  const have = jar.get("exv")?.value;
  if (have && /^[a-z0-9]{10}$/.test(have)) return have;
  if (!create) return null;
  const id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => "abcdefghijklmnopqrstuvwxyz0123456789"[b % 36]).join("");
  jar.set("exv", id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" });
  return id;
}

export async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}
