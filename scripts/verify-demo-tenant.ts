/**
 * Pre-demo check: corre esto el día antes de una demo en vivo para un tenant.
 * Verifica en un solo paso lo que el guion de demo (Zombies/Networking/
 * Backup Orphans/TTL) pide chequear a mano: tier, credenciales Azure
 * cargadas, y políticas TTL habilitadas.
 *
 * No verifica los roles RBAC en Azure (Reader/Cost Management Reader) —
 * eso sigue siendo el botón "Verify Permissions" del panel de Onboarding,
 * que ya hace la llamada real a Azure y no tiene sentido duplicar acá.
 *
 * Uso: npm run verify:demo-tenant -- <tenantId>
 */
import pool from "@/modules/storage/db";
import { normalizeTier, hasAccess } from "@/lib/tierLogic";

async function main() {
    const tenantId = process.argv[2];
    if (!tenantId) {
        console.error("Uso: npm run verify:demo-tenant -- <tenantId>");
        process.exit(1);
    }

    const issues: string[] = [];

    const [tenantRows]: any = await pool.query(
        "SELECT tier, client_id, client_secret FROM Tenants WHERE tenant_id = ? LIMIT 1",
        [tenantId]
    );
    const tenant = tenantRows?.[0];

    if (!tenant) {
        console.error(`✗ Tenant "${tenantId}" no existe en la tabla Tenants.`);
        process.exit(1);
    }

    const normalized = normalizeTier(tenant.tier || "");
    console.log(`Tier en DB: "${tenant.tier}" → normalizado: ${normalized || "DESCONOCIDO (fail-closed)"}`);
    if (!normalized) {
        issues.push(`Tier "${tenant.tier}" no matchea ningún tier válido — /cleanup/ttl (vencidos) va a bloquear salvo acceso SUPERADMIN.`);
    } else if (!hasAccess(normalized, "Business")) {
        issues.push(`Tier actual (${normalized}) no alcanza Business — /cleanup/ttl (vencidos) va a bloquear salvo acceso SUPERADMIN. La pestaña /cleanup/ttl/unlabeled sí funciona igual.`);
    }

    const hasCreds = Boolean(tenant.client_id && tenant.client_secret);
    console.log(`Credenciales Azure en DB (backup de Key Vault): ${hasCreds ? "presentes" : "ausentes"}`);
    if (!hasCreds) {
        issues.push("No hay client_id/client_secret en la tabla Tenants (puede que solo estén en Key Vault — confirmar con 'Verify Permissions' en el panel de Onboarding).");
    }

    const [policyRows]: any = await pool.query(
        "SELECT resource_type, days_to_live, enabled FROM TtlPolicies WHERE tenant_id = ?",
        [tenantId]
    );
    const activePolicies = (policyRows || []).filter((p: any) => p.enabled);
    console.log(`Políticas TTL habilitadas: ${activePolicies.length}`);
    if (activePolicies.length === 0) {
        issues.push("No hay TtlPolicies habilitadas — la pestaña 4 (TTL/Unlabeled) va a salir vacía.");
    } else {
        for (const p of activePolicies) {
            console.log(`  - ${p.resource_type}: ${p.days_to_live} días`);
        }
    }

    console.log("\n--- Resumen ---");
    if (issues.length === 0) {
        console.log("✓ Todo listo para la demo. Recordá igual precalentar el caché entrando a las 4 pestañas antes.");
    } else {
        console.log(`✗ ${issues.length} punto(s) a resolver antes de la demo:`);
        issues.forEach((i) => console.log(`  - ${i}`));
    }

    process.exit(issues.length === 0 ? 0 : 1);
}

main().catch((err) => {
    console.error("Error corriendo la verificación:", err);
    process.exit(1);
});
