import { NextRequest, NextResponse } from "next/server";
import pool, { initializeDatabase } from "@/modules/storage/db";
import { AuthError, requireSuperAdmin } from "@/lib/requestAuth";
import { encryptSecret } from "@/lib/secretCrypto";
import { invalidateAIConfigCache } from "@/modules/core/aiProvider";

/**
 * Fallback global de proveedor de IA (GlobalSettings.ai_provider/ai_api_key)
 * — usado por cualquier tenant que NO configuró su propia key en
 * /admin/ai-config (BYOK per-tenant). Antes esta tabla solo se LEÍA
 * (getAIConfig en src/services/aiService.ts) — no existía ningún endpoint
 * para escribirla, la única forma de setearla era a mano en la DB o vía
 * GEMINI_API_KEY en el .env del VPS.
 */

const PROVIDERS = new Set(["google", "openai", "azure_openai", "anthropic", "deepseek"]);

export async function GET(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const [rows]: any = await pool.query(
            `SELECT setting_key, setting_value FROM GlobalSettings WHERE setting_key IN ('ai_provider', 'ai_api_key')`
        );
        const map: Record<string, string> = {};
        for (const r of rows || []) map[r.setting_key] = r.setting_value;

        return NextResponse.json({
            success: true,
            provider: map.ai_provider || "google",
            hasApiKey: Boolean(map.ai_api_key),
        });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/config/ai-global] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function PATCH(request: NextRequest) {
    try {
        await initializeDatabase();
        await requireSuperAdmin(request);

        const body = await request.json().catch(() => ({}));
        const provider = String(body.provider || "google");
        const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";

        if (!PROVIDERS.has(provider)) {
            return NextResponse.json({ error: `Proveedor inválido. Debe ser uno de: ${[...PROVIDERS].join(", ")}` }, { status: 400 });
        }

        await pool.query(
            `INSERT INTO GlobalSettings (setting_key, setting_value) VALUES ('ai_provider', ?)
             ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
            [provider]
        );

        // apiKey vacío = no tocar la key existente (solo se actualiza el
        // proveedor). Para borrarla explícitamente, mandar apiKey: null.
        if (apiKey) {
            await pool.query(
                `INSERT INTO GlobalSettings (setting_key, setting_value) VALUES ('ai_api_key', ?)
                 ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
                [encryptSecret(apiKey)]
            );
        } else if (body.apiKey === null) {
            await pool.query(`DELETE FROM GlobalSettings WHERE setting_key = 'ai_api_key'`);
        }

        // Cache in-memory de 5 min en aiProvider.ts — invalidar para que el
        // cambio surta efecto de inmediato (mismo criterio que el PATCH per-tenant).
        invalidateAIConfigCache();

        return NextResponse.json({ success: true });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[admin/config/ai-global] PATCH error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
