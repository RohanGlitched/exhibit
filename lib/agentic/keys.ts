import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject } from "node:crypto";import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * The signing keys behind agent mandates, and the public key set anyone can verify them with.
 *
 * Two roles, each an Ed25519 key held in env as a base64 PKCS#8 DER (or PEM) private key:
 * - wallet: the cardholder's wallet, which signs intent mandates (EXHIBIT_WALLET_SIGNING_KEY);
 * - agent: the buyer's agent platform, which signs the cart its agent is about to pay for (EXHIBIT_AGENT_SIGNING_KEY).
 * In this demo Exhibit plays both platforms; in production each would hold its own key and publish its own set.
 *
 * Without the env keys: a dev server makes a key pair once and keeps it in .data/keys/ (ignored by git); tests
 * and scripts get a fresh in-memory pair; a production build has no key, so agent stories can't be opened and
 * the published set leaves that role out. Private keys never leave this module.
 */

export type Role = "wallet" | "agent";

export const ROLES: Record<Role, { env: string; name: string; signs: string }> = {
  wallet: { env: "EXHIBIT_WALLET_SIGNING_KEY", name: "Cardholder wallet (demo)", signs: "intent mandates" },
  agent: { env: "EXHIBIT_AGENT_SIGNING_KEY", name: "Buyer's agent platform (demo)", signs: "cart mandates" },
};

export interface Signer {
  role: Role;
  kid: string;
  privateKey: KeyObject;
  publicKey: KeyObject;
  spki: string; // base64 SPKI DER
  origin: "env" | "dev-file" | "ephemeral";
}

const spkiOf = (k: KeyObject) => k.export({ format: "der", type: "spki" }).toString("base64");

/** A key id that names the role and pins the key: "agent-3f9a1c0b77de". */
export const kidFor = (role: string, spki: string) => `${role}-${createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex").slice(0, 12)}`;

function parsePrivate(raw: string): KeyObject {
  const v = raw.trim();
  if (v.startsWith("-----BEGIN")) return createPrivateKey(v.replace(/\\n/g, "\n"));
  return createPrivateKey({ key: Buffer.from(v, "base64"), format: "der", type: "pkcs8" });
}

function signerFrom(role: Role, privateKey: KeyObject, origin: Signer["origin"]): Signer {
  const publicKey = createPublicKey(privateKey);
  const spki = spkiOf(publicKey);
  return { role, kid: kidFor(role, spki), privateKey, publicKey, spki, origin };
}

/** A new Ed25519 private key as the base64 PKCS#8 DER string the env vars take. */
export function newPrivateKey(): string {
  return generateKeyPairSync("ed25519").privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
}

const cache = new Map<Role, Signer | null>();

function devKey(role: Role): KeyObject {
  const dir = path.join(process.cwd(), ".data", "keys");
  const file = path.join(dir, `${role}.key`);
  try {
    return parsePrivate(readFileSync(file, "utf8"));
  } catch {
    const fresh = newPrivateKey();
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, fresh, { mode: 0o600 });
    } catch {
      /* read-only disk: the key lives as long as this process */
    }
    return parsePrivate(fresh);
  }
}

/** The signer for a role, or null when no key is configured (production without the env var). */
export function signer(role: Role): Signer | null {
  if (cache.has(role)) return cache.get(role)!;
  const raw = process.env[ROLES[role].env];
  let s: Signer | null = null;
  if (raw) s = signerFrom(role, parsePrivate(raw), "env");
  else if (process.env.NODE_ENV === "development") s = signerFrom(role, devKey(role), "dev-file");
  else if (process.env.NODE_ENV !== "production") s = signerFrom(role, parsePrivate(newPrivateKey()), "ephemeral");
  cache.set(role, s);
  return s;
}

/** The signer for a role, or an error that says which env var to set. */
export function requireSigner(role: Role): Signer {
  const s = signer(role);
  if (!s) throw new Error(`${ROLES[role].env} is not set, so Exhibit can't sign ${ROLES[role].signs}. See .env.example.`);
  return s;
}

/** A published public key: what /.well-known/exhibit-keys.json lists. */
export interface PublishedKey {
  kty: "OKP";
  crv: "Ed25519";
  x: string; // base64url raw public key
  kid: string;
  use: "sig";
  alg: "EdDSA";
  role: Role;
  name: string;
  signs: string;
}

export function publishedKeys(): PublishedKey[] {
  return (Object.keys(ROLES) as Role[]).flatMap((role) => {
    const s = signer(role);
    if (!s) return [];
    const jwk = s.publicKey.export({ format: "jwk" }) as { x: string };
    return [{ kty: "OKP" as const, crv: "Ed25519" as const, x: jwk.x, kid: s.kid, use: "sig" as const, alg: "EdDSA" as const, role, name: ROLES[role].name, signs: ROLES[role].signs }];
  });
}

/** A trusted key found by kid, with the role it is published for. */
export interface TrustedKey {
  kid: string;
  role: string;
  key: KeyObject;
  spki: string;
  /** Where the key comes from, for the check's wording. */
  source: "published" | "standin" | "sample";
}

export type KeyResolver = (kid: string) => TrustedKey | null;

/** Exhibit's published key set: the only keys a new mandate can verify against. */
export const publishedResolver: KeyResolver = (kid) => {
  for (const role of Object.keys(ROLES) as Role[]) {
    const s = signer(role);
    if (s && s.kid === kid) return { kid, role, key: s.publicKey, spki: s.spki, source: "published" };
  }
  return null;
};

/** A resolver over a fixed list of keys (the home page sample, tests). */
export function resolverOf(keys: { role: string; publicKey: KeyObject }[], source: TrustedKey["source"] = "sample"): KeyResolver {
  const list = keys.map((k) => ({ role: k.role, key: k.publicKey, spki: spkiOf(k.publicKey) }));
  return (kid) => {
    const hit = list.find((k) => kidFor(k.role, k.spki) === kid);
    return hit ? { kid, role: hit.role, key: hit.key, spki: hit.spki, source } : null;
  };
}

/** Throwaway keys for a sample that is labelled as one (the home page): never published, never stored. */
export function sampleKeys(): { wallet: Signer; agent: Signer; resolve: KeyResolver } {
  const wallet = signerFrom("wallet", parsePrivate(newPrivateKey()), "ephemeral");
  const agent = signerFrom("agent", parsePrivate(newPrivateKey()), "ephemeral");
  return { wallet, agent, resolve: resolverOf([wallet, agent], "sample") };
}

/** A forger: a fresh key that claims someone else's kid (the forged-mandate variant and tests). */
export function forger(claimKid: string): Pick<Signer, "kid" | "privateKey" | "spki"> {
  const s = signerFrom("agent", parsePrivate(newPrivateKey()), "ephemeral");
  return { kid: claimKid, privateKey: s.privateKey, spki: s.spki };
}

export const fingerprintOf = (spki: string) =>
  createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex").slice(0, 16).replace(/(.{4})(?!$)/g, "$1:");
