import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

const ACADEMY_CONTENT = [
    {
        id: "module-1",
        title: "Conceptos Básicos de Presupuesto",
        description: "Aprende a leer y configurar las alertas de presupuesto (Burn Rate) antes de que el dinero se agote.",
        content: `### Bienvenido a FinOps 101

El presupuesto es la base de cualquier estrategia FinOps. No se trata solo de limitar el gasto, sino de **predecir** cuándo te quedarás sin fondos usando el *Burn Rate*.

#### ¿Qué es el Burn Rate?
Es la velocidad a la que consumes tu presupuesto. Si tienes $1,000 para todo el mes y en el día 15 ya gastaste $800, tu Burn Rate es demasiado alto.

#### Mejores Prácticas:
1. **Configura múltiples umbrales:** No avises solo al 100%. Configura alertas al 50%, 75% y 90%.
2. **Alertas a los responsables:** Envía el webhook directo al canal de Slack de los ingenieros, no solo a finanzas.
3. **Revisa los picos:** Si hay un salto anormal, usa el módulo de **Anomalías** para investigar.`,
        duration: "5 min",
        suggestOnboardingScript: true
    },
    {
        id: "module-2",
        title: "Cómo entender tu factura de Azure",
        description: "Desmitificando los recursos Zombie y los costos ocultos de transferencia de red (Egress).",
        content: `### Desenmascarando a Azure

La factura en la nube suele ser incomprensible por diseño. Aquí te enseñamos los dos principales "vampiros" de dinero:

#### 1. Recursos Zombis 🧟
Son recursos que estás pagando pero que no hacen nada.
- **Discos Huerfanos:** Eliminaste una Máquina Virtual, pero olvidaste borrar el disco (Storage). Azure te seguirá cobrando por él para siempre.
- **IPs Públicas No Asociadas:** Una IP estática que no está conectada a ningún servidor cuesta dinero.

#### 2. Costos de Egress (Transferencia de Red) 🌐
Meter datos a Azure (Ingress) es gratis. **Sacarlos (Egress) cuesta mucho dinero.**
Si tu base de datos y tu frontend están en regiones distintas (ej. East US y Brazil South), pagarás un impuesto enorme por cada byte de transferencia inter-región.`,
        duration: "8 min",
        suggestOnboardingScript: false
    },
    {
        id: "module-3",
        title: "Derecho de Uso (Hybrid Benefit)",
        description: "No pagues doble. Reutiliza tus licencias de Windows y SQL Server.",
        content: `### El Secreto Mejor Guardado de Microsoft

Cuando creas una Máquina Virtual en Azure (Windows o SQL), por defecto pagas bajo el modelo **PAYG (Pay-As-You-Go)**. Esto significa que estás rentando la licencia de Windows por hora.

Si tu empresa ya compró licencias de Windows Server para su Datacenter local (On-Premise) y tienen *Software Assurance* activo, **estás perdiendo dinero**.

#### Azure Hybrid Benefit (AHB)
AHB te permite aplicar esas licencias que ya posees directamente en la nube. ¡Puedes ahorrar hasta un 45% del costo de cómputo en un solo clic!
Ve a nuestro escáner de Beneficio Híbrido en el menú lateral para detectar dónde estás fallando.`,
        duration: "10 min",
        suggestOnboardingScript: false
    }
];

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        
        if (!tenantId) {
            return NextResponse.json({ error: "Tenant ID requerido" }, { status: 400 });
        }

        const identity = await requireTenantAccess(request, tenantId);
        const oid = identity.claims.oid;

        // Get user progress. userId=1 (mock default) NUNCA debe usarse para un
        // tenant real: si el usuario autenticado no tiene fila propia en Users
        // todavía (race de sincronización, usuario recién agregado), leer/
        // escribir con userId=1 mezclaría su progreso con el de otro usuario
        // real que sí tenga ese id en el mismo tenant.
        let userId: number | null = isMockTenant(tenantId) ? 1 : null;
        if (oid && !isMockTenant(tenantId)) {
            const [userRows]: any = await pool.query('SELECT id FROM Users WHERE entra_oid = ? AND tenant_id = ?', [oid, tenantId]);
            if (userRows && userRows.length > 0) {
                userId = userRows[0].id;
            }
        }

        let completedModules: string[] = [];
        if (!isMockTenant(tenantId) && userId !== null) {
            const [progressRows]: any = await pool.query('SELECT module_id FROM AcademyProgress WHERE user_id = ? AND tenant_id = ?', [userId, tenantId]);
            completedModules = progressRows.map((row: any) => row.module_id);
        }

        const modulesWithProgress = ACADEMY_CONTENT.map(mod => ({
            ...mod,
            isCompleted: completedModules.includes(mod.id)
        }));

        return NextResponse.json({ 
            success: true, 
            modules: modulesWithProgress,
            totalCompleted: completedModules.length,
            isCertified: completedModules.length === ACADEMY_CONTENT.length
        });

    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[academy/content] GET error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { tenantId, moduleId } = body;

        if (!tenantId || !moduleId) {
            return NextResponse.json({ error: "Faltan parámetros" }, { status: 400 });
        }

        if (isMockTenant(tenantId)) {
            return NextResponse.json({ success: true, message: "Progreso guardado (Mock)" });
        }

        const identity = await requireTenantAccess(request, tenantId);
        const oid = identity.claims.oid;

        // Mismo motivo que en GET: sin fila propia en Users, no hay un userId
        // legítimo al cual atribuir el progreso — se responde éxito sin
        // persistir en vez de contaminar el progreso de otro usuario (id=1).
        let userId: number | null = null;
        if (oid) {
            const [userRows]: any = await pool.query('SELECT id FROM Users WHERE entra_oid = ? AND tenant_id = ?', [oid, tenantId]);
            if (userRows && userRows.length > 0) {
                userId = userRows[0].id;
            }
        }
        if (userId === null) {
            return NextResponse.json({ success: true, message: "Progreso no persistido (usuario aún no sincronizado)" });
        }

        await pool.query(
            'INSERT IGNORE INTO AcademyProgress (user_id, tenant_id, module_id) VALUES (?, ?, ?)',
            [userId, tenantId, moduleId]
        );

        // Verify if all modules are completed to mark tenant as onboarded
        const [progressRows]: any = await pool.query('SELECT module_id FROM AcademyProgress WHERE user_id = ? AND tenant_id = ?', [userId, tenantId]);
        if (progressRows && progressRows.length >= ACADEMY_CONTENT.length) {
            await pool.query('UPDATE Tenants SET is_onboarded = 1 WHERE tenant_id = ?', [tenantId]);
        }

        return NextResponse.json({ success: true, message: "Módulo completado" });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[academy/content] POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
