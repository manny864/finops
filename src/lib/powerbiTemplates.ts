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
 */

export interface PowerBITemplate {
    id: string;
    name: string;
    description: string;
    category: "cost" | "sustainability" | "governance" | "unit-economics";
    categoryDisplayName?: string;
    feedType: string;
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
        categoryDisplayName: "Cost Analytics",
        feedType: "costs",
        sampleVisualizations: [
            "Card: Total Cost USD (MTD / 90d)",
            "Line chart: Tendencia diaria de costos",
            "Bar chart: Top 10 recursos por costo",
            "Donut chart: Distribución por suscripción",
            "Matrix: Costo por servicio × mes",
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
    Expanded = Table.ExpandRecordColumn(AsTable, "Column1", 
        {"date", "service", "subscriptionName", "resourceGroup", "resourceName", "costUSD"}, 
        {"Date", "Service", "Subscription", "Resource Group", "Resource Name", "Cost (USD)"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"Date", type date}, 
        {"Service", type text}, 
        {"Subscription", type text},
        {"Resource Group", type text}, 
        {"Resource Name", type text}, 
        {"Cost (USD)", type number}
    })
in
    Typed
`,
    },
    {
        id: "sustainability",
        name: "Sustainability & Carbon",
        description: "Emisiones CO2e por región, breakdown VM/Storage, recomendaciones de migración a regiones verdes.",
        category: "sustainability",
        categoryDisplayName: "ESG & Carbon",
        feedType: "sustainability",
        sampleVisualizations: [
            "Card: kg CO2e total mensual",
            "Map (Azure): Emisiones por región geográfica",
            "Bar chart: Equivalencias estimadas (árboles, km auto)",
            "Table: Recomendaciones de migración con % reducción",
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
    Expanded = Table.ExpandRecordColumn(AsTable, "Column1", 
        {"region", "kgCO2e", "resources", "intensity"},
        {"Region", "Emissions (kgCO2e)", "Resources Count", "Grid Carbon Intensity"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"Region", type text}, 
        {"Emissions (kgCO2e)", type number},
        {"Resources Count", Int64.Type}, 
        {"Grid Carbon Intensity", Int64.Type}
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
        categoryDisplayName: "Governance & Waste",
        feedType: "zombies",
        sampleVisualizations: [
            "Card: Total Waste USD/mes",
            "Bar chart: Top recursos zombies por costo",
            "Donut chart: Distribución por tipo de recurso huérfano",
            "Table: Detalle con Resource ID, ubicación y costo",
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
        {"Resource ID", "Resource Type", "Location", "Estimated Monthly Waste (USD)"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"Resource ID", type text}, 
        {"Resource Type", type text},
        {"Location", type text}, 
        {"Estimated Monthly Waste (USD)", type number}
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
        categoryDisplayName: "Budgets & Forecast",
        feedType: "budgets",
        sampleVisualizations: [
            "Gauge: % consumido por presupuesto",
            "Bar chart: Presupuesto asignado vs gasto real",
            "Table: Lista con semáforo de estado de alerta",
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
        {"name", "period", "budgetUSD", "spentUSD", "usagePct", "status"},
        {"Budget Name", "Period", "Budget (USD)", "Spent (USD)", "Usage %", "Status"}),
    Typed = Table.TransformColumnTypes(Expanded, {
        {"Budget Name", type text}, 
        {"Period", type text},
        {"Budget (USD)", type number}, 
        {"Spent (USD)", type number},
        {"Usage %", type number}, 
        {"Status", type text}
    })
in
    Typed
`,
    },
];

export function getTemplate(id: string): PowerBITemplate | undefined {
    return POWERBI_TEMPLATES.find(t => t.id === id);
}
