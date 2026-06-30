/**
 * Power BI Templates registry (Feature G).
 *
 * Cada template describe un reporte Power BI listo para que el usuario
 * lo arme via Get Data > Web/JSON, con scripts Power Query M precargados.
 *
 * Estrategia: en lugar de generar .pbit binarios (formato complejo,
 * DataMashup encryption), entregamos:
 *   1. Script Power Query M (texto) que el usuario pega.
 *   2. URL del feed de datos (autenticado por API key MCP o token Entra).
 *   3. Documentación de visualizaciones recomendadas.
 *
 * Esto es la misma estrategia que Microsoft FinOps Toolkit usa para
 * algunos de sus Power BI Connectors.
 */

export interface PowerBITemplate {
    id: string;
    name: string;
    description: string;
    category: "cost" | "sustainability" | "governance" | "unit-economics";
    feedType: string;                  // type param para /api/exports/powerbi-feed
    sampleVisualizations: string[];
    powerQueryM: string;
}

const COMMON_HEADER = `// Para usar este script:
// 1. Power BI Desktop → Get Data → Blank Query
// 2. Home → Advanced Editor → pegar este script
// 3. Reemplazar <YOUR_BASE_URL> y <YOUR_MCP_KEY> con tus valores
// 4. Done → Refresh
`;

export const POWERBI_TEMPLATES: PowerBITemplate[] = [
    {
        id: "cost-overview",
        name: "FinOps Cost Overview",
        description: "Resumen de costos diarios, top resources, breakdown por servicio y suscripción. 30/90/365 días.",
        category: "cost",
        feedType: "costs",
        sampleVisualizations: [
            "Card: total cost USD (30d)",
            "Line chart: daily cost trend",
            "Bar chart: top 10 resources por costo",
            "Donut: distribución por subscription",
            "Matrix: costo por servicio × mes",
        ],
        powerQueryM: `${COMMON_HEADER}
let
    BaseUrl = "<YOUR_BASE_URL>",
    ApiKey = "<YOUR_MCP_KEY>",
    Days = 90,
    Source = Json.Document(Web.Contents(
        BaseUrl & "/api/exports/powerbi-feed",
        [
            Query = [type = "costs", days = Text.From(Days)],
            Headers = [#"Authorization" = "Bearer " & ApiKey]
        ]
    )),
    DataList = Source[data],
    AsTable = Table.FromList(DataList, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
    Expanded = Table.ExpandRecordColumn(AsTable, "Column1", {"date", "costUSD"}, {"Date", "Cost (USD)"}),
    Typed = Table.TransformColumnTypes(Expanded, {{"Date", type date}, {"Cost (USD)", type number}})
in
    Typed
`,
    },
    {
        id: "sustainability",
        name: "Sustainability & Carbon",
        description: "Emisiones CO2e por región, breakdown VM/Storage, recomendaciones de migración a regiones verdes.",
        category: "sustainability",
        feedType: "sustainability",
        sampleVisualizations: [
            "Card: kg CO2e total mensual",
            "Map (Azure): emisiones por región",
            "Bar: equivalencias (km auto, árboles)",
            "Table: recomendaciones de migración con % reducción",
        ],
        powerQueryM: `${COMMON_HEADER}
let
    BaseUrl = "<YOUR_BASE_URL>",
    ApiKey = "<YOUR_MCP_KEY>",
    Source = Json.Document(Web.Contents(
        BaseUrl & "/api/exports/powerbi-feed",
        [
            Query = [type = "sustainability"],
            Headers = [#"Authorization" = "Bearer " & ApiKey]
        ]
    )),
    Regions = Source[byRegion],
    AsTable = Table.FromList(Regions, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
    Expanded = Table.ExpandRecordColumn(AsTable, "Column1", {"region", "kgCO2e", "resources", "intensity"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"region", type text}, {"kgCO2e", type number},
        {"resources", Int64.Type}, {"intensity", Int64.Type}
    })
in
    Typed
`,
    },
    {
        id: "zombies",
        name: "Zombie Resources & Waste",
        description: "Recursos huérfanos detectados (discos sin atar, NICs, IPs), costo mensual desperdiciado.",
        category: "governance",
        feedType: "zombies",
        sampleVisualizations: [
            "Card: total waste USD/mes",
            "Bar: top zombies por costo",
            "Donut: distribución por tipo de recurso",
            "Table: detalle con resource_id y location",
        ],
        powerQueryM: `${COMMON_HEADER}
let
    BaseUrl = "<YOUR_BASE_URL>",
    ApiKey = "<YOUR_MCP_KEY>",
    Source = Json.Document(Web.Contents(
        BaseUrl & "/api/exports/powerbi-feed",
        [
            Query = [type = "zombies"],
            Headers = [#"Authorization" = "Bearer " & ApiKey]
        ]
    )),
    Zombies = Source[data],
    AsTable = Table.FromList(Zombies, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
    Expanded = Table.ExpandRecordColumn(AsTable, "Column1",
        {"resource_id", "resource_type", "location", "estimated_monthly_cost_usd"},
        {"Resource ID", "Type", "Location", "Monthly Cost (USD)"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"Resource ID", type text}, {"Type", type text},
        {"Location", type text}, {"Monthly Cost (USD)", type number}
    })
in
    Typed
`,
    },
    {
        id: "budgets",
        name: "Budget Tracking",
        description: "Estado de presupuestos: gasto actual vs límite, % usado, status (ok/warning/exceeded).",
        category: "cost",
        feedType: "budgets",
        sampleVisualizations: [
            "Gauge: % consumido por budget",
            "Bar: budget vs spent",
            "Table: lista con status semáforo",
        ],
        powerQueryM: `${COMMON_HEADER}
let
    BaseUrl = "<YOUR_BASE_URL>",
    ApiKey = "<YOUR_MCP_KEY>",
    Source = Json.Document(Web.Contents(
        BaseUrl & "/api/exports/powerbi-feed",
        [
            Query = [type = "budgets"],
            Headers = [#"Authorization" = "Bearer " & ApiKey]
        ]
    )),
    Budgets = Source[data],
    AsTable = Table.FromList(Budgets, Splitter.SplitByNothing(), null, null, ExtraValues.Error),
    Expanded = Table.ExpandRecordColumn(AsTable, "Column1",
        {"name", "period", "budgetUSD", "spentUSD", "usagePct", "status"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"name", type text}, {"period", type text},
        {"budgetUSD", type number}, {"spentUSD", type number},
        {"usagePct", type number}, {"status", type text}
    })
in
    Typed
`,
    },
];

export function getTemplate(id: string): PowerBITemplate | undefined {
    return POWERBI_TEMPLATES.find(t => t.id === id);
}
