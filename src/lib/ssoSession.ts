import { SignJWT, jwtVerify, JWTPayload } from "jose";
import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import crypto from "crypto";

const SESSION_COOKIE_NAME = "finops_sso";
const SESSION_TTL_HOURS = 12;

async function getSigningKey(): Promise<Uint8Array> {
    const secret = process.env.SSO_SESSION_SECRET;
    if (!secret) {
        throw new Error("SSO_SESSION_SECRET not configured");
    }
    // Ensure minimum 32 characters for HS256
    if (secret.length < 32) {
        throw new Error("SSO_SESSION_SECRET must be at least 32 characters");
    }
    return new TextEncoder().encode(secret);
}

export interface SsoSessionData {
    tenantId: string;
    email: string;
    workosUserId?: string;
}

interface SsoSessionPayload extends JWTPayload {
    sid: string;
    tenantId: string;
    email: string;
    workosUserId?: string;
}

/**
 * Create and insert a new SSO session, then set the cookie on the response
 */
export async function setSsoCookie(
    response: NextResponse,
    data: SsoSessionData
): Promise<string> {
    const key = await getSigningKey();
    const sessionId = crypto.randomBytes(32).toString("hex");
    const now = Math.floor(Date.now() / 1000);
    const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 60 * 60 * 1000);

    const payload: Record<string, unknown> = {
        sid: sessionId,
        tenantId: data.tenantId,
        email: data.email,
        workosUserId: data.workosUserId,
    };

    // Sign JWT with HS256
    const token = await new SignJWT(payload)
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt(now)
        .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
        .sign(key);

    // Insert into DB
    await pool.query(
        `INSERT INTO SSOSessions (id, tenant_id, email, workos_user_id, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
        [sessionId, data.tenantId, data.email, data.workosUserId || null, expiresAt]
    );

    // Set HttpOnly, Secure (if production), SameSite=Lax cookie
    const isSecure = process.env.NODE_ENV === "production";
    response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: token,
        httpOnly: true,
        secure: isSecure,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_HOURS * 60 * 60,
    });

    return token;
}

/**
 * Read and verify the SSO session cookie from the request
 */
export async function getSsoSession(
    request: NextRequest
): Promise<SsoSessionData | null> {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
    if (!token) return null;

    try {
        const key = await getSigningKey();
        const { payload } = await jwtVerify(token, key);

        const sessionPayload = payload as SsoSessionPayload;

        // Verify session still exists in DB and hasn't expired
        const [rows] = await pool.query(
            `SELECT expires_at FROM SSOSessions WHERE id = ? AND expires_at > NOW()`,
            [sessionPayload.sid]
        );

        if (!Array.isArray(rows) || rows.length === 0) {
            return null;
        }

        return {
            tenantId: sessionPayload.tenantId,
            email: sessionPayload.email,
            workosUserId: sessionPayload.workosUserId,
        };
    } catch (err) {
        // Invalid or expired token
        return null;
    }
}

/**
 * Clear the SSO session cookie from the response and delete the DB session
 */
export async function clearSsoCookie(response: NextResponse, request: NextRequest): Promise<void> {
    const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;

    if (token) {
        try {
            const key = await getSigningKey();
            const { payload } = await jwtVerify(token, key);
            const sessionPayload = payload as SsoSessionPayload;

            // Delete from DB
            await pool.query(`DELETE FROM SSOSessions WHERE id = ?`, [sessionPayload.sid]);
        } catch {
            // Token invalid, ignore
        }
    }

    // Clear cookie
    response.cookies.set({
        name: SESSION_COOKIE_NAME,
        value: "",
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 0,
    });
}
