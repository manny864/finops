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
    /**
     * La descripcion, la categoria y las visualizaciones sugeridas se
     * mostraban tal cual las escribe este archivo — en castellano sobre la UI
     * en ingles. Viajan tambien como clave de catalogo (namespace
     * PowerBITemplates) y el texto queda de fallback, misma convencion que
     * `nameKey` en el resto de la plataforma.
     */
    description: string;
    descriptionKey?: string;
    category: "cost" | "sustainability" | "governance" | "unit-economics";
    categoryDisplayName?: string;
    categoryDisplayNameKey?: string;
    feedType: string;
    sampleVisualizations: string[];
    visualizationKeys?: string[];
    powerQueryM: string;
}

/**
 * Constructor del script Power Query M.
 *
 * Los cuatro templates eran casi identicos copiados a mano y habian derivado
 * entre si (uno leia `Source[data]` sin proteger, otros no). Con un solo
 * constructor, un arreglo vale para los cuatro.
 *
 * Los comentarios viajan como marcadores `{{cmt.X}}` y los resuelve el cliente
 * con `resolveScriptComments` — misma convencion que los scripts CLI de las
 * rutas de bases de datos, para no tener que generar un script por idioma.
 */
function buildPowerQuery(opts: {
    feedType: string;
    payloadField: string;
    /** [campo en el JSON, titulo de la columna, tipo M] */
    columns: Array<[string, string, string]>;
    extraQuery?: string;
}): string {
    const { feedType, payloadField, columns, extraQuery } = opts;
    const campos = columns.map(([src]) => `"${src}"`).join(', ');
    const titulos = columns.map(([, dst]) => `"${dst}"`).join(', ');
    const tipos = columns.map(([, dst, tipo]) => `        {"${dst}", ${tipo}}`).join(',\n');
    const esquema = columns.map(([, dst, tipo]) => `        #"${dst}" = ${tipo.replace('type ', '')}`).join(',\n');
    const query = extraQuery ? `[type = "${feedType}", ${extraQuery}]` : `[type = "${feedType}"]`;

    return `// {{cmt.pq_howTo}}
// 1. Power BI Desktop > Get Data > Blank Query
// 2. Home > Advanced Editor
// 3. {{cmt.pq_paste}}
// 4. Done > Refresh
//
// {{cmt.pq_keyWarning}}

let
    BaseUrl = "<YOUR_BASE_URL>",
    ApiKey  = "<YOUR_MCP_KEY>",

    // {{cmt.pq_relativePath}}
    Response = Json.Document(Web.Contents(
        BaseUrl,
        [
            RelativePath = "api/exports/powerbi-feed",
            Query        = ${query},
            Headers      = [#"Authorization" = "Bearer " & ApiKey]
        ]
    )),

    // {{cmt.pq_guard}}
    Payload = try Response[${payloadField}] otherwise {},

    Esquema = type table[
${esquema}
    ],

    Result =
        if List.IsEmpty(Payload) then
            #table(Esquema, {})
        else
            let
                AsTable  = Table.FromList(Payload, Splitter.SplitByNothing(), {"Record"}),
                // {{cmt.pq_expand}}
                Expanded = Table.ExpandRecordColumn(
                    AsTable, "Record",
                    {${campos}},
                    {${titulos}}
                )
            in
                Table.TransformColumnTypes(Expanded, {
${tipos}
                })
in
    Result
`;
}

export const POWERBI_TEMPLATES: PowerBITemplate[] = [
    {
        id: "cost-overview",
        name: "FinOps Cost Overview",
        description: "Resumen de costos diarios, top resources, breakdown por servicio y suscripción. 30/90/365 días.",
        descriptionKey: "tpl_cost_desc",
        category: "cost",
        categoryDisplayName: "Cost Analytics",
        categoryDisplayNameKey: "tplcat_cost",
        feedType: "costs",
        sampleVisualizations: [
            "Card: Total Cost USD (MTD / 90d)",
            "Line chart: Tendencia diaria de costos",
            "Bar chart: Top 10 recursos por costo",
            "Donut chart: Distribución por suscripción",
            "Matrix: Costo por servicio × mes",
        ],
        visualizationKeys: ["tplviz_cost_1", "tplviz_cost_2", "tplviz_cost_3", "tplviz_cost_4", "tplviz_cost_5"],
        powerQueryM: buildPowerQuery({
            feedType: "costs",
            payloadField: "data",
            extraQuery: 'days = "90"',
            columns: [
                ["date", "Date", "type datetime"],
                ["service", "Service", "type text"],
                ["subscriptionName", "Subscription", "type text"],
                ["resourceGroup", "Resource Group", "type text"],
                ["resourceName", "Resource Name", "type text"],
                ["costUSD", "Cost (USD)", "type number"],
            ],
        }),
    },
    {
        id: "sustainability",
        name: "Sustainability & Carbon",
        description: "Emisiones CO2e por región, breakdown VM/Storage, recomendaciones de migración a regiones verdes.",
        descriptionKey: "tpl_sust_desc",
        category: "sustainability",
        categoryDisplayName: "ESG & Carbon",
        categoryDisplayNameKey: "tplcat_sust",
        feedType: "sustainability",
        sampleVisualizations: [
            "Card: kg CO2e total mensual",
            "Map (Azure): Emisiones por región geográfica",
            "Bar chart: Equivalencias estimadas (árboles, km auto)",
            "Table: Recomendaciones de migración con % reducción",
        ],
        visualizationKeys: ["tplviz_sust_1", "tplviz_sust_2", "tplviz_sust_3", "tplviz_sust_4"],
        powerQueryM: buildPowerQuery({
            feedType: "sustainability",
            payloadField: "byRegion",
            columns: [
                ["region", "Region", "type text"],
                ["kgCO2e", "Emissions (kgCO2e)", "type number"],
                ["resources", "Resources Count", "Int64.Type"],
                ["intensity", "Grid Carbon Intensity", "Int64.Type"],
            ],
        }),
    },
    {
        id: "zombies",
        name: "Zombie Resources & Waste",
        description: "Recursos huérfanos detectados (discos sin atar, NICs, IPs), costo mensual desperdiciado.",
        descriptionKey: "tpl_zomb_desc",
        category: "governance",
        categoryDisplayName: "Governance & Waste",
        categoryDisplayNameKey: "tplcat_zomb",
        feedType: "zombies",
        sampleVisualizations: [
            "Card: Total Waste USD/mes",
            "Bar chart: Top recursos zombies por costo",
            "Donut chart: Distribución por tipo de recurso huérfano",
            "Table: Detalle con Resource ID, ubicación y costo",
        ],
        visualizationKeys: ["tplviz_zomb_1", "tplviz_zomb_2", "tplviz_zomb_3", "tplviz_zomb_4"],
        powerQueryM: buildPowerQuery({
            feedType: "zombies",
            payloadField: "data",
            columns: [
                ["resource_id", "Resource ID", "type text"],
                ["resource_type", "Resource Type", "type text"],
                ["location", "Location", "type text"],
                ["estimated_monthly_cost_usd", "Estimated Monthly Waste (USD)", "type number"],
            ],
        }),
    },
    {
        id: "budgets",
        name: "Budget Tracking",
        description: "Estado de presupuestos: gasto actual vs límite, % usado, status (ok/warning/exceeded).",
        descriptionKey: "tpl_budg_desc",
        category: "cost",
        categoryDisplayName: "Budgets & Forecast",
        categoryDisplayNameKey: "tplcat_budg",
        feedType: "budgets",
        sampleVisualizations: [
            "Gauge: % consumido por presupuesto",
            "Bar chart: Presupuesto asignado vs gasto real",
            "Table: Lista con semáforo de estado de alerta",
        ],
        visualizationKeys: ["tplviz_budg_1", "tplviz_budg_2", "tplviz_budg_3"],
        powerQueryM: buildPowerQuery({
            feedType: "budgets",
            payloadField: "data",
            columns: [
                ["name", "Budget Name", "type text"],
                ["period", "Period", "type text"],
                ["budgetUSD", "Budget (USD)", "type number"],
                ["spentUSD", "Spent (USD)", "type number"],
                ["usagePct", "Usage %", "type number"],
                ["status", "Status", "type text"],
            ],
        }),
    },
];

export function getTemplate(id: string): PowerBITemplate | undefined {
    return POWERBI_TEMPLATES.find(t => t.id === id);
}
