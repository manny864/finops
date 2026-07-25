import { NextRequest, NextResponse } from "next/server";
import pool from "@/modules/storage/db";
import { requireTenantRole, AuthError } from "@/lib/requestAuth";
import { decryptExternalId } from "@/lib/aws/sts";
import {
    generateAwsCloudFormationTemplate,
    generateAwsTerraformTemplate,
    generateAwsCliSnippet,
    isValidAwsAccountId,
} from "@/lib/awsOnboardingTemplate";

/**
 * Genera los artefactos de onboarding AWS (CloudFormation / Terraform / CLI)
 * para una cuenta ya dada de alta. Equivalente a `/api/admin/onboarding`, que
 * hace lo mismo para Azure con un script de PowerShell.
 *
 * RBAC: `requireTenantRole(['ADMIN','OWNER'])` — mínimo suficiente. La
 * respuesta incluye el `externalId` de la cuenta, que es el secreto que ata la
 * confianza entre la cuenta del cliente y la de la plataforma; un Reader no
 * tiene por qué verlo.
 *
 * Es POST y no GET a propósito: así el `awsAccountId` no queda en la query
 * string de los logs de acceso, y deja claro que no es un recurso cacheable.
 *
 * Que el `externalId` se pueda volver a obtener (descifrándolo) es deliberado:
 * el alta lo devuelve una única vez, y sin esto un cliente que cerró la pestaña
 * antes de aplicar la plantilla tenía que borrar la cuenta y crearla de nuevo.
 * El valor no pierde su función —evitar el confused deputy— por ser
 * recuperable por un Admin del propio tenant.
 */
export async function POST(request: NextRequest) {
    try {
        const body = await request.json().catch(() => ({}));
        const tenantId = String(body.tenantId || "");
        const awsAccountRowId = String(body.awsAccountId || "");

        if (!tenantId || !awsAccountRowId) {
            return NextResponse.json(
                { error: "Faltan parámetros tenantId o awsAccountId." },
                { status: 400 }
            );
        }

        await requireTenantRole(request, tenantId, ["ADMIN", "OWNER"]);

        const platformAccountId =
            process.env.AWS_PLATFORM_ACCOUNT_ID
            || process.env.NEXT_PUBLIC_AWS_PLATFORM_ACCOUNT_ID
            || "";
        if (!isValidAwsAccountId(platformAccountId)) {
            // Fail-closed: sin esto se generaría una plantilla con un principal
            // placeholder que el cliente aplicaría creyendo que quedó conectado.
            return NextResponse.json(
                { error: "El onboarding AWS no está configurado en esta instancia (falta AWS_PLATFORM_ACCOUNT_ID)." },
                { status: 503 }
            );
        }

        // El filtro por tenant_id va en el WHERE, no sólo en el guard: evita
        // que un Admin de un tenant genere la plantilla de una cuenta de otro.
        const [rows] = await pool.query(
            `SELECT account_id, external_id_encrypted, cur_bucket, cur_prefix
               FROM AwsAccounts
              WHERE id = ? AND tenant_id = ?
              LIMIT 1`,
            [awsAccountRowId, tenantId]
        );
        const account = Array.isArray(rows) && rows.length > 0
            ? (rows[0] as {
                account_id: string;
                external_id_encrypted: string;
                cur_bucket: string | null;
                cur_prefix: string | null;
            })
            : null;

        if (!account) {
            return NextResponse.json({ error: "Cuenta AWS no encontrada." }, { status: 404 });
        }

        let externalId: string;
        try {
            externalId = decryptExternalId(account.external_id_encrypted);
        } catch {
            return NextResponse.json(
                { error: "No se pudo recuperar el ExternalId de la cuenta." },
                { status: 500 }
            );
        }

        const params = {
            platformAccountId,
            externalId,
            curBucket: account.cur_bucket || undefined,
            curPrefix: account.cur_prefix || undefined,
        };

        return NextResponse.json({
            success: true,
            accountId: account.account_id,
            externalId,
            platformAccountId,
            cloudFormation: generateAwsCloudFormationTemplate(params),
            terraform: generateAwsTerraformTemplate(params),
            cli: generateAwsCliSnippet(params),
        });
    } catch (e) {
        if (e instanceof AuthError) {
            return NextResponse.json({ error: e.message }, { status: e.status });
        }
        console.error("[admin/onboarding/aws]", e);
        return NextResponse.json({ error: "Error interno del servidor." }, { status: 500 });
    }
}
