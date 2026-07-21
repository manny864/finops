import { NextRequest, NextResponse } from "next/server";
import { isMockTenant } from "@/lib/mockData";
import pool from "@/modules/storage/db";
import { requireTenantAccess, AuthError } from "@/lib/requestAuth";

// Contenido de las lecciones, por locale — a diferencia del resto de la UI
// (que usa next-intl), este texto vive en la API porque incluye markdown
// largo con formato; cada locale es un array paralelo con los mismos IDs.
const ACADEMY_CONTENT_ES = [
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

const ACADEMY_CONTENT_EN = [
    {
        id: "module-1",
        title: "Budget Basics",
        description: "Learn to read and configure budget alerts (Burn Rate) before the money runs out.",
        content: `### Welcome to FinOps 101

Budgeting is the foundation of any FinOps strategy. It's not just about limiting spend — it's about **predicting** when you'll run out of funds using the *Burn Rate*.

#### What is Burn Rate?
It's the speed at which you consume your budget. If you have $1,000 for the whole month and by day 15 you've already spent $800, your Burn Rate is too high.

#### Best Practices:
1. **Set multiple thresholds:** Don't wait until 100%. Set alerts at 50%, 75% and 90%.
2. **Alert the right people:** Send the webhook straight to the engineers' Slack channel, not only to finance.
3. **Check the spikes:** If there's an abnormal jump, use the **Anomalies** module to investigate.`,
        duration: "5 min",
        suggestOnboardingScript: true
    },
    {
        id: "module-2",
        title: "Understanding Your Azure Bill",
        description: "Demystifying Zombie resources and the hidden costs of network transfer (Egress).",
        content: `### Unmasking Azure

Cloud bills are often confusing by design. Here are the two main money "vampires":

#### 1. Zombie Resources 🧟
Resources you're paying for but that do nothing.
- **Orphaned Disks:** You deleted a Virtual Machine but forgot to delete its disk (Storage). Azure will keep billing you for it forever.
- **Unassociated Public IPs:** A static IP that isn't connected to any server still costs money.

#### 2. Egress Costs (Network Transfer) 🌐
Bringing data into Azure (Ingress) is free. **Taking it out (Egress) costs a lot of money.**
If your database and your frontend are in different regions (e.g. East US and Brazil South), you'll pay a huge tax on every byte of inter-region transfer.`,
        duration: "8 min",
        suggestOnboardingScript: false
    },
    {
        id: "module-3",
        title: "License Mobility (Hybrid Benefit)",
        description: "Don't pay twice. Reuse your Windows and SQL Server licenses.",
        content: `### Microsoft's Best-Kept Secret

When you create a Virtual Machine in Azure (Windows or SQL), by default you pay under the **PAYG (Pay-As-You-Go)** model. That means you're renting the Windows license by the hour.

If your company already bought Windows Server licenses for its on-premises datacenter and has active *Software Assurance*, **you're losing money**.

#### Azure Hybrid Benefit (AHB)
AHB lets you apply those licenses you already own directly in the cloud. You can save up to 45% on compute cost with a single click!
Check our Hybrid Benefit scanner in the side menu to find out where you're missing out.`,
        duration: "10 min",
        suggestOnboardingScript: false
    }
];

const ACADEMY_CONTENT_PT_BR = [
    {
        id: "module-1",
        title: "Conceitos Básicos de Orçamento",
        description: "Aprenda a ler e configurar alertas de orçamento (Burn Rate) antes que o dinheiro acabe.",
        content: `### Bem-vindo ao FinOps 101

O orçamento é a base de qualquer estratégia FinOps. Não se trata apenas de limitar o gasto, mas de **prever** quando os fundos vão acabar usando o *Burn Rate*.

#### O que é Burn Rate?
É a velocidade com que você consome seu orçamento. Se você tem $1.000 para o mês todo e no dia 15 já gastou $800, seu Burn Rate está alto demais.

#### Melhores Práticas:
1. **Configure múltiplos limiares:** Não avise só em 100%. Configure alertas em 50%, 75% e 90%.
2. **Alerte os responsáveis:** Envie o webhook direto para o canal de Slack dos engenheiros, não só para o financeiro.
3. **Revise os picos:** Se houver um salto anormal, use o módulo de **Anomalias** para investigar.`,
        duration: "5 min",
        suggestOnboardingScript: true
    },
    {
        id: "module-2",
        title: "Como entender sua fatura da Azure",
        description: "Desmistificando os recursos Zumbis e os custos ocultos de transferência de rede (Egress).",
        content: `### Desmascarando a Azure

A fatura na nuvem costuma ser incompreensível por design. Aqui estão os dois principais "vampiros" de dinheiro:

#### 1. Recursos Zumbis 🧟
São recursos que você está pagando mas que não fazem nada.
- **Discos Órfãos:** Você excluiu uma Máquina Virtual, mas esqueceu de excluir o disco (Storage). A Azure vai continuar cobrando por ele para sempre.
- **IPs Públicos Não Associados:** Um IP estático que não está conectado a nenhum servidor custa dinheiro.

#### 2. Custos de Egress (Transferência de Rede) 🌐
Colocar dados na Azure (Ingress) é grátis. **Tirá-los (Egress) custa muito dinheiro.**
Se seu banco de dados e seu frontend estão em regiões diferentes (ex.: East US e Brazil South), você pagará um imposto enorme por cada byte de transferência inter-região.`,
        duration: "8 min",
        suggestOnboardingScript: false
    },
    {
        id: "module-3",
        title: "Direito de Uso (Hybrid Benefit)",
        description: "Não pague em dobro. Reutilize suas licenças de Windows e SQL Server.",
        content: `### O Segredo Mais Bem Guardado da Microsoft

Ao criar uma Máquina Virtual na Azure (Windows ou SQL), por padrão você paga no modelo **PAYG (Pay-As-You-Go)**. Isso significa que você está alugando a licença do Windows por hora.

Se sua empresa já comprou licenças de Windows Server para seu Datacenter local (On-Premise) e tem *Software Assurance* ativo, **você está perdendo dinheiro**.

#### Azure Hybrid Benefit (AHB)
O AHB permite aplicar essas licenças que você já possui diretamente na nuvem. Você pode economizar até 45% do custo de computação com um único clique!
Acesse nosso scanner de Benefício Híbrido no menu lateral para detectar onde você está perdendo dinheiro.`,
        duration: "10 min",
        suggestOnboardingScript: false
    }
];

const ACADEMY_CONTENT_BY_LOCALE: Record<string, typeof ACADEMY_CONTENT_ES> = {
    es: ACADEMY_CONTENT_ES,
    en: ACADEMY_CONTENT_EN,
    "pt-BR": ACADEMY_CONTENT_PT_BR,
};

function getAcademyContent(locale: string | null) {
    return ACADEMY_CONTENT_BY_LOCALE[locale || ""] || ACADEMY_CONTENT_ES;
}

export async function GET(request: NextRequest) {
    try {
        const { searchParams } = new URL(request.url);
        const tenantId = searchParams.get('tenantId');
        const content = getAcademyContent(searchParams.get('locale'));

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
        // Match por (entra_oid OR email) — mismo criterio que requireTenantRole
        // en requestAuth.ts: el oid del token puede no coincidir con el
        // guardado (usuario invitado antes de loguearse la primera vez), pero
        // el email siempre identifica la fila real.
        let userId: number | null = isMockTenant(tenantId) ? 1 : null;
        if (!isMockTenant(tenantId) && (oid || identity.email)) {
            const [userRows]: any = await pool.query('SELECT id FROM Users WHERE tenant_id = ? AND (entra_oid = ? OR email = ?)', [tenantId, oid || '', identity.email || '']);
            if (userRows && userRows.length > 0) {
                userId = userRows[0].id;
            }
        }

        let completedModules: string[] = [];
        if (!isMockTenant(tenantId) && userId !== null) {
            const [progressRows]: any = await pool.query('SELECT module_id FROM AcademyProgress WHERE user_id = ? AND tenant_id = ?', [userId, tenantId]);
            completedModules = progressRows.map((row: any) => row.module_id);
        }

        const modulesWithProgress = content.map(mod => ({
            ...mod,
            isCompleted: completedModules.includes(mod.id)
        }));

        return NextResponse.json({
            success: true,
            modules: modulesWithProgress,
            totalCompleted: completedModules.length,
            isCertified: completedModules.length === content.length
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

        // Mismo motivo que en GET: match por (entra_oid OR email). Si de
        // verdad no hay fila propia en Users, no hay un userId legítimo al
        // cual atribuir el progreso — se responde error explícito en vez de
        // fingir éxito (antes esto hacía que el botón "funcionara" pero nunca
        // persistiera nada, sin ningún indicio del problema).
        let userId: number | null = null;
        if (oid || identity.email) {
            const [userRows]: any = await pool.query('SELECT id FROM Users WHERE tenant_id = ? AND (entra_oid = ? OR email = ?)', [tenantId, oid || '', identity.email || '']);
            if (userRows && userRows.length > 0) {
                userId = userRows[0].id;
            }
        }
        if (userId === null) {
            return NextResponse.json({ error: "No se pudo identificar tu usuario en este tenant. Recargá la página o contactá a soporte." }, { status: 409 });
        }

        await pool.query(
            'INSERT IGNORE INTO AcademyProgress (user_id, tenant_id, module_id) VALUES (?, ?, ?)',
            [userId, tenantId, moduleId]
        );

        return NextResponse.json({ success: true, message: "Módulo completado" });
    } catch (error: unknown) {
        if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
        console.error("[academy/content] POST error:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
