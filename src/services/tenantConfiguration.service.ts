/**
 * tenantConfiguration.service — lectura/escritura de la pestaña General de
 * Configuración Global (tema, marca, integraciones).
 *
 * RBAC: este servicio NO valida identidad. Las rutas que lo llaman resuelven el
 * guard (`requireTenantRole(['Admin','Owner'])` para escritura, `requireTenantAccess`
 * para lectura) antes de invocarlo.
 *
 * El estado vive en columnas de `Tenants` (ver migración 20260822-005 para el
 * porqué de no crear tablas nuevas).
 */
import pool from '@/modules/storage/db';
import { decryptSecret, encryptSecret } from '@/lib/secretCrypto';
import type {
    ItsmSystemType,
    SaveItsmPayload,
    TenantGlobalConfig,
    ThemePreferenceType,
} from '@/types/tenantConfiguration.types';
import { isItsmSystem, themeToDb } from '@/types/tenantConfiguration.types';

interface TenantConfigRow {
    company_name: string | null;
    logo_stored_name: string | null;
    webhook_url: string | null;
    theme_preference: ThemePreferenceType | null;
    itsm_system: ItsmSystemType | null;
    itsm_base_url: string | null;
    itsm_user_email: string | null;
    itsm_api_key_encrypted: string | null;
    itsm_project_key: string | null;
}

/** Path del feed FOCUS que consume Power BI (token por header, ver getPowerBiExportUrl). */
export const POWERBI_FEED_PATH = '/api/exports/powerbi-feed';

export function getPowerBiExportUrl(baseUrl: string): string {
    return `${baseUrl.replace(/\/+$/, '')}${POWERBI_FEED_PATH}?dataset=costs&days=90`;
}

/**
 * Lee la configuración general del tenant.
 *
 * Fallback de esquema: si la migración 20260822-005 todavía no corrió en esta
 * réplica, el SELECT ancho rompe con ER_BAD_FIELD_ERROR. En vez de devolver 500
 * se reintenta con las columnas que existen desde siempre y los campos nuevos
 * caen a sus defaults. Se filtra por código de error a propósito: un timeout o
 * una conexión caída deben propagarse, no disfrazarse de "esquema viejo".
 */
export async function getTenantConfiguration(
    tenantId: string,
    baseUrl: string
): Promise<TenantGlobalConfig | null> {
    let row: TenantConfigRow | undefined;

    try {
        const [rows] = await pool.query<any[]>(
            `SELECT company_name, logo_stored_name, webhook_url, theme_preference,
                    itsm_system, itsm_base_url, itsm_user_email, itsm_api_key_encrypted, itsm_project_key
             FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        row = rows?.[0];
    } catch (err) {
        if ((err as { code?: string }).code !== 'ER_BAD_FIELD_ERROR') throw err;
        console.warn('[tenantConfiguration] 20260822-005 pendiente; leyendo esquema previo.');
        const [legacyRows] = await pool.query<any[]>(
            `SELECT company_name, logo_stored_name, webhook_url FROM Tenants WHERE tenant_id = ? LIMIT 1`,
            [tenantId]
        );
        row = legacyRows?.[0];
    }

    if (!row) return null;

    const webhookUrl = row.webhook_url || undefined;

    return {
        tenantId,
        theme: row.theme_preference || 'SYSTEM',
        branding: {
            organizationName: row.company_name || '',
            hasCustomLogo: Boolean(row.logo_stored_name),
            customLogoUrl: row.logo_stored_name ? `/api/tenant-logo/${tenantId}` : undefined,
        },
        integrations: {
            proactiveAlertsWebhookUrl: webhookUrl,
            itsmSystem: row.itsm_system || 'NONE',
            itsmBaseUrl: row.itsm_base_url || undefined,
            itsmUserEmail: row.itsm_user_email || undefined,
            itsmProjectKey: row.itsm_project_key || undefined,
            powerBiExportUrl: getPowerBiExportUrl(baseUrl),
            isWebhookConfigured: Boolean(webhookUrl),
            // El secreto no sale de acá — sólo si existe.
            isItsmConfigured: Boolean(row.itsm_api_key_encrypted && row.itsm_base_url),
        },
    };
}

export async function saveThemePreference(
    tenantId: string,
    theme: string
): Promise<ThemePreferenceType> {
    const normalized = themeToDb(theme);
    await pool.query('UPDATE Tenants SET theme_preference = ? WHERE tenant_id = ?', [
        normalized,
        tenantId,
    ]);
    return normalized;
}

/**
 * Guarda la configuración ITSM. `apiKey` ausente o vacío conserva el secreto
 * existente: la UI nunca recibe el valor guardado, así que reenviar el campo
 * vacío en un submit de "cambié sólo la URL" no debe borrar la credencial.
 */
export async function saveItsmConfiguration(
    tenantId: string,
    payload: SaveItsmPayload
): Promise<void> {
    const system: ItsmSystemType = isItsmSystem(payload.system) ? payload.system : 'NONE';

    if (system === 'NONE') {
        await pool.query(
            `UPDATE Tenants
             SET itsm_system = 'NONE', itsm_base_url = NULL, itsm_user_email = NULL,
                 itsm_api_key_encrypted = NULL, itsm_project_key = NULL
             WHERE tenant_id = ?`,
            [tenantId]
        );
        return;
    }

    const fields = [
        'itsm_system = ?',
        'itsm_base_url = ?',
        'itsm_user_email = ?',
        'itsm_project_key = ?',
    ];
    const values: (string | null)[] = [
        system,
        payload.baseUrl?.trim() || null,
        payload.userEmail?.trim() || null,
        payload.projectKey?.trim() || null,
    ];

    if (payload.apiKey && payload.apiKey.trim()) {
        fields.push('itsm_api_key_encrypted = ?');
        values.push(encryptSecret(payload.apiKey.trim()));
    }

    values.push(tenantId);
    await pool.query(`UPDATE Tenants SET ${fields.join(', ')} WHERE tenant_id = ?`, values);
}

/**
 * Credenciales ITSM en claro, sólo para uso server-side (prueba de conexión y
 * creación de tickets). Nunca serializar el resultado hacia el cliente.
 */
export async function getItsmCredentials(tenantId: string): Promise<{
    system: ItsmSystemType;
    baseUrl: string;
    userEmail: string;
    apiKey: string;
    projectKey: string;
} | null> {
    const [rows] = await pool.query<any[]>(
        `SELECT itsm_system, itsm_base_url, itsm_user_email, itsm_api_key_encrypted, itsm_project_key
         FROM Tenants WHERE tenant_id = ? LIMIT 1`,
        [tenantId]
    );
    const row = rows?.[0];
    if (!row || !row.itsm_system || row.itsm_system === 'NONE') return null;

    return {
        system: row.itsm_system,
        baseUrl: row.itsm_base_url || '',
        userEmail: row.itsm_user_email || '',
        apiKey: decryptSecret(row.itsm_api_key_encrypted),
        projectKey: row.itsm_project_key || '',
    };
}
