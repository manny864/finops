import crypto from "crypto";
import { NextRequest } from "next/server";
import pool from "@/modules/storage/db";

export interface ApiAuthResult {
  tenantId: string;
  keyId: number;
  name: string;
  scopes: string[];
  rateLimitPerMin: number;
}

export class ApiError extends Error {
  status: number;

  constructor(message: string, status = 401) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export function generateApiKey(): { plaintext: string; hash: string; prefix: string } {
  const env = process.env.NODE_ENV === "production" ? "live" : "test";
  const randomPart = crypto.randomBytes(16).toString("hex");
  const plaintext = `pak_${env}_${randomPart}`;
  const hash = crypto.createHash("sha256").update(plaintext).digest("hex");
  const prefix = plaintext.substring(0, 12);
  return { plaintext, hash, prefix };
}

export async function verifyApiKey(request: NextRequest): Promise<ApiAuthResult | null> {
  const authHeader = request.headers.get("authorization") || "";
  const xApiKey = request.headers.get("x-api-key") || "";

  let token: string | null = null;

  if (authHeader.toLowerCase().startsWith("bearer ")) {
    token = authHeader.slice(7).trim();
  } else if (xApiKey && xApiKey.startsWith("pak_")) {
    token = xApiKey;
  }

  if (!token || !token.startsWith("pak_")) {
    return null;
  }

  const hash = crypto.createHash("sha256").update(token).digest("hex");

  try {
    const [rows] = await pool.query(
      `SELECT id, tenant_id, name, scopes, rate_limit_per_min FROM PublicApiKeys 
       WHERE key_hash = ? AND enabled = TRUE LIMIT 1`,
      [hash]
    );

    const arr = rows as Array<{
      id: number;
      tenant_id: string;
      name: string;
      scopes: string;
      rate_limit_per_min: number;
    }>;

    if (arr.length === 0) {
      return null;
    }

    const key = arr[0];
    const scopes = typeof key.scopes === "string" ? JSON.parse(key.scopes) : key.scopes;

    // Update last_used_at asynchronously (fire-and-forget)
    pool.query(`UPDATE PublicApiKeys SET last_used_at = NOW() WHERE id = ?`, [key.id]).catch(() => {});

    return {
      tenantId: key.tenant_id,
      keyId: key.id,
      name: key.name,
      scopes: Array.isArray(scopes) ? scopes : [],
      rateLimitPerMin: key.rate_limit_per_min,
    };
  } catch (error) {
    console.error("Error verifying API key:", error);
    return null;
  }
}

export function requireScope(authResult: ApiAuthResult, scope: string): void {
  if (!authResult.scopes.includes(scope)) {
    throw new ApiError(`Insufficient scope. Required: ${scope}`, 403);
  }
}
