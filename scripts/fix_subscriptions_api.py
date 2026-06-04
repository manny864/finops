import os

base_dir = "/Users/manuelchavez/Documents/FinOpsProyect"
api_path = os.path.join(base_dir, "src/app/api/subscriptions/route.ts")
sop_path = os.path.join(base_dir, "directivas/frontend_api_wiring_SOP.md")

# 1. Update SOP
with open(sop_path, "a") as f:
    f.write("\\n- **Multitenancy Bypass**: Todas las rutas de API (incluyendo `/api/subscriptions`) DEBEN validar el token permitiendo un bypass si el usuario es administrador (ej. `@cscloudsolutions.com.ar`). Si se omite esto, el dropdown de suscripciones quedará vacío al devolver 403 para usuarios SaaS Admins.\\n")

# 2. Update API
with open(api_path, "r") as f:
    content = f.read()

old_logic = """    const decoded = jwt.decode(token) as { tid?: string } | null;
    if (!decoded || decoded.tid !== tenantId) {
      return NextResponse.json({ error: "Acceso denegado. Tenant ID inválido." }, { status: 403 });
    }"""

new_logic = """    const decoded = jwt.decode(token) as any;
    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json({ error: `Acceso denegado. El token no coincide con el tenant.` }, { status: 403 });
    }"""

if old_logic in content:
    content = content.replace(old_logic, new_logic)
    with open(api_path, "w") as f:
        f.write(content)
    print("API /api/subscriptions/route.ts fixed.")
else:
    print("Old logic not found or already fixed.")
