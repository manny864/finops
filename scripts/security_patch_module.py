import os
import re

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"

def deploy():
    print("1. Creando Directiva SOP para Seguridad...")
    os.makedirs(os.path.join(base_dir, "directivas"), exist_ok=True)
    sop_path = os.path.join(base_dir, "directivas/security_patch_SOP.md")
    with open(sop_path, "w") as f:
        f.write("# Security Patches SOP\\n\\n")
        f.write("## Objetivo\\n1. Mitigar Inyección PowerShell validando estrictamente el formato UUID.\\n")
        f.write("2. Mitigar Inyección SQL asegurando que ninguna cadena SQL sea construida por concatenación (+), usando template literals de un solo string y variables parametrizadas (?).\\n\\n")
        f.write("## Restricciones/Casos Borde\\n- **Nota: Tenant Isolation no fue implementado estrictamente** para no romper el modelo de SuperAdmin cross-tenant de la plataforma SaaS.\\n")

    print("2. Parcheando onboardingScriptTemplate.ts (PowerShell Injection)...")
    template_path = os.path.join(base_dir, "src/lib/onboardingScriptTemplate.ts")
    with open(template_path, "r") as f:
        template_content = f.read()

    if "uuidRegex" not in template_content:
        new_logic = """export function generateOnboardingScript(clientTenantId: string, subscriptionId: string): string {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(clientTenantId) || !uuidRegex.test(subscriptionId)) {
        throw new Error("Invalid ID format");
    }
"""
        template_content = template_content.replace(
            "export function generateOnboardingScript(clientTenantId: string, subscriptionId: string): string {",
            new_logic
        )
        with open(template_path, "w") as f:
            f.write(template_content)

    print("3. Parcheando onboarding/route.ts...")
    onboarding_route_path = os.path.join(base_dir, "src/app/api/admin/onboarding/route.ts")
    with open(onboarding_route_path, "r") as f:
        onboard_content = f.read()
    
    if "try {\\n            const script = generateOnboardingScript" not in onboard_content:
        onboard_content = onboard_content.replace(
            "const script = generateOnboardingScript(clientTenantId, subscriptionId);",
            """let script;
        try {
            script = generateOnboardingScript(clientTenantId, subscriptionId);
        } catch (err: any) {
            return NextResponse.json({ error: err.message }, { status: 400 });
        }"""
        )
        with open(onboarding_route_path, "w") as f:
            f.write(onboard_content)

    print("4. Parcheando intelligence/history/route.ts (SQL Injection)...")
    history_route_path = os.path.join(base_dir, "src/app/api/intelligence/history/route.ts")
    with open(history_route_path, "r") as f:
        history_content = f.read()
    
    # We want to replace the + concatenation with a single string
    old_sql = '"INSERT INTO SavingsHistory (tenant_id, scan_date, total_wasted_usd, potential_savings_usd) VALUES (?, ?, ?, ?) " +\\n            "ON DUPLICATE KEY UPDATE total_wasted_usd = VALUES(total_wasted_usd), potential_savings_usd = VALUES(potential_savings_usd)",'
    new_sql = '`INSERT INTO SavingsHistory (tenant_id, scan_date, total_wasted_usd, potential_savings_usd) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE total_wasted_usd = VALUES(total_wasted_usd), potential_savings_usd = VALUES(potential_savings_usd)`,'
    
    if old_sql in history_content:
        history_content = history_content.replace(old_sql, new_sql)
        with open(history_route_path, "w") as f:
            f.write(history_content)
    else:
        # Fallback if whitespace differs
        history_content = re.sub(
            r'"INSERT INTO SavingsHistory[^"]+"\s*\+\s*"ON DUPLICATE KEY UPDATE[^"]+",',
            new_sql,
            history_content
        )
        with open(history_route_path, "w") as f:
            f.write(history_content)

    print("Script completado.")

if __name__ == "__main__":
    deploy()
