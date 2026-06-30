/**
 * Azure Key Vault client wrapper.
 *
 * Características:
 *  - Singleton SecretClient autenticado con ClientSecretCredential
 *    (Service Principal, ideal para deploys fuera de Azure como Hostinger).
 *  - Cache en memoria con TTL "fresh" + ventana "stale-while-revalidate"
 *    para sobrevivir cortes transitorios de red Hostinger ↔ Azure.
 *  - Cache encriptado en disco (AES-256-GCM) que se carga al boot para
 *    permitir operación degradada si Azure KV no responde en cold-start.
 *  - Bypass total cuando AZURE_KEYVAULT_ENABLED != "true".
 *
 * Env vars requeridas:
 *  - AZURE_KEYVAULT_URL                  (https://NAME.vault.azure.net/)
 *  - AZURE_KEYVAULT_TENANT_ID
 *  - AZURE_KEYVAULT_CLIENT_ID
 *  - AZURE_KEYVAULT_CLIENT_SECRET
 *
 * Env vars opcionales:
 *  - AZURE_KEYVAULT_ENABLED              ("true" para activar; default off)
 *  - AZURE_KEYVAULT_CACHE_TTL_SECONDS    (default 1800 = 30min)
 *  - AZURE_KEYVAULT_STALE_TTL_SECONDS    (default 86400 = 24h)
 *  - AZURE_KEYVAULT_CACHE_PATH           (default ~/.finops-data/kv-cache.enc)
 *  - AZURE_KEYVAULT_CACHE_KEY            (32 bytes hex/base64; sino usa MFA_ENCRYPTION_KEY)
 *  - MFA_ENCRYPTION_KEY                  (fallback para derivar la cache key)
 */

import { SecretClient } from "@azure/keyvault-secrets";
import { ClientSecretCredential } from "@azure/identity";
import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import os from "os";

interface CacheEntry {
  value: string;
  fetchedAt: number;
}

const FRESH_TTL_MS = (Number(process.env.AZURE_KEYVAULT_CACHE_TTL_SECONDS) || 1800) * 1000;
const STALE_TTL_MS = (Number(process.env.AZURE_KEYVAULT_STALE_TTL_SECONDS) || 86400) * 1000;
const MAX_CACHE_ENTRIES = 1024;

let clientSingleton: SecretClient | null = null;
const memoryCache = new Map<string, CacheEntry>();
let diskCacheLoaded = false;
let pendingPersist: NodeJS.Timeout | null = null;

function getCachePath(): string {
  return (
    process.env.AZURE_KEYVAULT_CACHE_PATH ||
    path.join(os.homedir(), ".finops-data", "kv-cache.enc")
  );
}

function getCacheEncryptionKey(): Buffer | null {
  const raw =
    process.env.AZURE_KEYVAULT_CACHE_KEY || process.env.MFA_ENCRYPTION_KEY;
  if (!raw) return null;
  if (/^[0-9a-f]{64}$/i.test(raw)) return Buffer.from(raw, "hex");
  const b = Buffer.from(raw, "base64");
  if (b.length === 32) return b;
  return crypto.createHash("sha256").update(raw).digest();
}

export function isKeyVaultEnabled(): boolean {
  return (
    process.env.AZURE_KEYVAULT_ENABLED === "true" &&
    !!process.env.AZURE_KEYVAULT_URL &&
    !!process.env.AZURE_KEYVAULT_TENANT_ID &&
    !!process.env.AZURE_KEYVAULT_CLIENT_ID &&
    !!process.env.AZURE_KEYVAULT_CLIENT_SECRET
  );
}

function getClient(): SecretClient {
  if (clientSingleton) return clientSingleton;
  if (!isKeyVaultEnabled()) {
    throw new Error("Azure Key Vault is not enabled or not configured");
  }
  const credential = new ClientSecretCredential(
    process.env.AZURE_KEYVAULT_TENANT_ID!,
    process.env.AZURE_KEYVAULT_CLIENT_ID!,
    process.env.AZURE_KEYVAULT_CLIENT_SECRET!
  );
  clientSingleton = new SecretClient(
    process.env.AZURE_KEYVAULT_URL!,
    credential,
    {
      retryOptions: { maxRetries: 3, retryDelayInMs: 200 },
    }
  );
  return clientSingleton;
}

function evictIfFull(): void {
  while (memoryCache.size > MAX_CACHE_ENTRIES) {
    const firstKey = memoryCache.keys().next().value;
    if (firstKey === undefined) break;
    memoryCache.delete(firstKey);
  }
}

async function loadDiskCache(): Promise<void> {
  if (diskCacheLoaded) return;
  diskCacheLoaded = true;
  const key = getCacheEncryptionKey();
  if (!key) return;
  try {
    const raw = await fs.readFile(getCachePath());
    if (raw.length < 28) return;
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const plain = Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8"
    );
    const obj = JSON.parse(plain) as Record<string, CacheEntry>;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v.value === "string" && typeof v.fetchedAt === "number") {
        memoryCache.set(k, v);
      }
    }
    console.log(
      `[keyvault] disk cache loaded: ${memoryCache.size} entries from ${getCachePath()}`
    );
  } catch (e: any) {
    if (e.code !== "ENOENT") {
      console.warn("[keyvault] disk cache load failed:", e.message);
    }
  }
}

function schedulePersist(): void {
  const key = getCacheEncryptionKey();
  if (!key) return;
  if (pendingPersist) return;
  pendingPersist = setTimeout(async () => {
    pendingPersist = null;
    try {
      const obj: Record<string, CacheEntry> = {};
      for (const [k, v] of memoryCache.entries()) obj[k] = v;
      const plain = Buffer.from(JSON.stringify(obj), "utf8");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
      const tag = cipher.getAuthTag();
      const out = Buffer.concat([iv, tag, ct]);
      const filePath = getCachePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, out, { mode: 0o600 });
    } catch (e: any) {
      console.warn("[keyvault] disk cache persist failed:", e.message);
    }
  }, 5000);
  if (typeof pendingPersist.unref === "function") pendingPersist.unref();
}

/**
 * Devuelve el valor del secret o null si no existe (404).
 * Throws si Key Vault no responde Y no hay valor stale en cache.
 */
export async function getSecret(name: string): Promise<string | null> {
  if (!isKeyVaultEnabled()) return null;
  await loadDiskCache();
  const now = Date.now();
  const cached = memoryCache.get(name);

  if (cached && now - cached.fetchedAt < FRESH_TTL_MS) {
    return cached.value;
  }

  try {
    const result = await getClient().getSecret(name);
    if (result.value === undefined) return null;
    memoryCache.set(name, { value: result.value, fetchedAt: now });
    evictIfFull();
    schedulePersist();
    return result.value;
  } catch (e: any) {
    if (e?.code === "SecretNotFound" || e?.statusCode === 404) return null;

    if (cached && now - cached.fetchedAt < STALE_TTL_MS) {
      console.warn(
        `[keyvault] using STALE cache for "${name}" (age=${Math.round(
          (now - cached.fetchedAt) / 1000
        )}s); error=${e?.message || e}`
      );
      return cached.value;
    }
    console.error(`[keyvault] getSecret("${name}") failed:`, e?.message || e);
    throw e;
  }
}

export async function setSecret(name: string, value: string): Promise<void> {
  if (!isKeyVaultEnabled()) {
    throw new Error("Key Vault not enabled; cannot setSecret");
  }
  await getClient().setSecret(name, value);
  memoryCache.set(name, { value, fetchedAt: Date.now() });
  evictIfFull();
  schedulePersist();
}

export async function deleteSecret(name: string): Promise<void> {
  if (!isKeyVaultEnabled()) return;
  try {
    const poller = await getClient().beginDeleteSecret(name);
    await poller.pollUntilDone();
  } catch (e: any) {
    if (e?.code !== "SecretNotFound" && e?.statusCode !== 404) throw e;
  }
  memoryCache.delete(name);
  schedulePersist();
}

/** Test helper. No usar en runtime. */
export function _resetForTests(): void {
  memoryCache.clear();
  diskCacheLoaded = false;
  clientSingleton = null;
  if (pendingPersist) {
    clearTimeout(pendingPersist);
    pendingPersist = null;
  }
}

/** Test helper. */
export function _setCacheForTests(name: string, value: string, fetchedAt: number): void {
  memoryCache.set(name, { value, fetchedAt });
}
