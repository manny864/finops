/**
 * Inventario de recursos AWS: la contraparte de `resourceInventoryService`
 * (Azure Resource Graph) para la sección "Recursos".
 *
 * **Por qué la Resource Groups Tagging API y no EC2.** `awsInventoryService`
 * sirve para la limpieza y sólo mira EC2, que es donde vive el desperdicio
 * clásico. Esta página es distinta: pregunta "qué tengo", no "qué desperdicio",
 * y responderla sólo con instancias EC2 daría una foto falsa de la cuenta. La
 * Resource Groups Tagging API (`GetResources`) devuelve **todos** los tipos de
 * recurso soportados con sus etiquetas en una sola llamada por región, sin
 * pedir un permiso `Describe*` por cada servicio. Es lo más parecido a Resource
 * Graph que ofrece AWS sin habilitar AWS Config, que se factura por item
 * registrado.
 *
 * **Diferencias con Azure que la UI ve, y por qué:**
 *
 * - **`resourceGroup` transporta la región.** Es la convención ya establecida
 *   en el resto del código AWS: AWS no tiene grupos de recursos con herencia.
 * - **`subscriptionId` es el account ID** de 12 dígitos.
 * - **`createdTime` es siempre `null`.** La Tagging API no expone fecha de
 *   creación y CloudTrail —que sí la tiene— es otra ingesta, con retención de
 *   90 días y un permiso adicional. Se devuelve `null` en vez de inventar una
 *   fecha, igual que el lado Azure omite el "Last Login" que no puede leer.
 * - **El costo por recurso sale de `FocusLineItems`, no de Cost Explorer.** El
 *   dato ya está ingestado por el camino CUR y consultarlo es gratis; Cost
 *   Explorer cobra por request. La contrapartida: un tenant que sólo conectó
 *   Cost Explorer verá el inventario pero con costo 0, porque Cost Explorer no
 *   desglosa por recurso.
 *
 * Permisos IAM: `tag:GetResources` y `tag:GetTagKeys`. Ambos de sólo lectura.
 */
import {
    ResourceGroupsTaggingAPIClient,
    GetResourcesCommand,
    type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import pool from '@/modules/storage/db';
import { assumeRole, decryptExternalId, type AwsTempCredentials } from '@/lib/aws/sts';

/** Mismo contrato que `InventoryResourceRow` del lado Azure. */
export interface AwsInventoryResourceRow {
    id: string;
    name: string;
    type: string;
    subscriptionId: string;
    subscriptionName: string;
    /** Región AWS. Se mapea a `resourceGroup` para reutilizar la UI de Azure. */
    resourceGroup: string;
    tags: Record<string, string>;
    /** Siempre null: la Tagging API no expone fecha de creación. */
    createdTime: string | null;
    periodCost?: number;
}

interface AwsAccountRow {
    account_id: string;
    alias: string | null;
    role_arn: string;
    external_id_encrypted: string;
}

/**
 * Descompone un ARN.
 *
 * Formato: `arn:partition:service:region:account-id:resource-type/resource-id`.
 * El último campo admite `/` o `:` como separador, y puede traer varios
 * niveles (`network-interface/eni-x`, `cluster/nombre/servicio`).
 */
export function parseArn(arn: string): {
    service: string;
    region: string;
    accountId: string;
    resourceType: string;
    resourceId: string;
} | null {
    if (!arn.startsWith('arn:')) return null;
    const parts = arn.split(':');
    if (parts.length < 6) return null;

    const [, , service, region, accountId] = parts;
    const tail = parts.slice(5).join(':');

    // El separador puede ser '/' o ':'. Se toma el primero que aparezca.
    const slash = tail.indexOf('/');
    const colon = tail.indexOf(':');
    let sep = -1;
    if (slash >= 0 && colon >= 0) sep = Math.min(slash, colon);
    else sep = Math.max(slash, colon);

    // Sin separador, todo el resto es el id y el tipo lo aporta el servicio
    // (por ejemplo `arn:aws:s3:::mi-bucket`).
    const resourceType = sep > 0 ? tail.slice(0, sep) : service;
    const resourceId = sep > 0 ? tail.slice(sep + 1) : tail;

    return { service, region, accountId, resourceType, resourceId };
}

/** Nombre legible: la etiqueta `Name` si existe, si no el id del ARN. */
export function resourceDisplayName(tags: Record<string, string>, resourceId: string): string {
    return tags.Name || tags.name || resourceId;
}

/** Normaliza un recurso de la Tagging API al contrato de la UI. */
export function mapTaggedResource(
    mapping: ResourceTagMapping,
    accountAlias: (accountId: string) => string
): AwsInventoryResourceRow | null {
    const arn = mapping.ResourceARN;
    if (!arn) return null;
    const parsed = parseArn(arn);
    if (!parsed) return null;

    const tags: Record<string, string> = {};
    for (const t of mapping.Tags ?? []) {
        if (t.Key) tags[t.Key] = t.Value ?? '';
    }

    return {
        id: arn,
        name: resourceDisplayName(tags, parsed.resourceId),
        // Mismo estilo que `awsInventoryService`: `aws.<servicio>/<tipo>`.
        type: `aws.${parsed.service}/${parsed.resourceType}`,
        subscriptionId: parsed.accountId,
        subscriptionName: accountAlias(parsed.accountId),
        resourceGroup: parsed.region || 'global',
        tags,
        createdTime: null,
    };
}

async function getAwsAccounts(tenantId: string, accountId?: string | null): Promise<AwsAccountRow[]> {
    const all = !accountId || accountId === 'all' || accountId === 'All';
    const [rows] = await pool.query(
        `SELECT account_id, alias, role_arn, external_id_encrypted
           FROM AwsAccounts
          WHERE tenant_id = ?${all ? '' : ' AND account_id = ?'}`,
        all ? [tenantId] : [tenantId, accountId]
    );
    return (Array.isArray(rows) ? rows : []) as AwsAccountRow[];
}

/**
 * Regiones donde el tenant tuvo gasto.
 *
 * Barrer las ~30 regiones de AWS en cada request sería lento y en su mayoría
 * inútil: una región sin gasto no tiene recursos que valga la pena inventariar.
 * `CostSnapshots.resource_group` guarda la región en AWS (convención del
 * proyecto).
 */
async function getActiveRegions(tenantId: string, accountId: string): Promise<string[]> {
    const [rows] = await pool.query(
        `SELECT DISTINCT resource_group AS region
           FROM CostSnapshots
          WHERE tenant_id = ? AND subscription_id = ?
            AND resource_group IS NOT NULL AND resource_group <> ''
            AND date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)`,
        [tenantId, accountId]
    );
    const regions = (Array.isArray(rows) ? rows : [])
        .map((r) => String((r as { region?: unknown }).region ?? ''))
        // 'global' y 'NoRegion' aparecen en el CUR para cargos sin region
        // (soporte, impuestos): no son endpoints validos de la Tagging API.
        .filter((r) => /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(r));
    // Sin historico todavia, us-east-1 es el minimo razonable: es donde viven
    // los recursos globales y la region por defecto de casi toda cuenta nueva.
    return regions.length > 0 ? regions : ['us-east-1'];
}

function taggingClientFor(region: string, creds: AwsTempCredentials): ResourceGroupsTaggingAPIClient {
    return new ResourceGroupsTaggingAPIClient({
        region,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
        },
    });
}

/** Recorre las páginas de `GetResources` acumulando los recursos. */
async function fetchRegionResources(
    client: ResourceGroupsTaggingAPIClient,
    region: string,
    accountId: string
): Promise<ResourceTagMapping[]> {
    const out: ResourceTagMapping[] = [];
    let token: string | undefined;
    try {
        do {
            const res = await client.send(new GetResourcesCommand({
                PaginationToken: token,
                // 100 es el maximo que admite la API cuando se piden tags.
                ResourcesPerPage: 100,
            }));
            out.push(...(res.ResourceTagMappingList ?? []));
            // La API devuelve string vacio, no undefined, en la ultima pagina.
            token = res.PaginationToken || undefined;
        } while (token);
    } catch (e) {
        // Una region sin permisos no puede dejar sin inventario a las demas.
        console.warn(`[AwsResourceInventory] ${accountId}/${region} GetResources fallo:`, (e as Error).message);
    }
    return out;
}

/** Todos los recursos etiquetables de las cuentas AWS del tenant. */
export async function getAwsAllResources(
    tenantId: string,
    accountId?: string | null
): Promise<AwsInventoryResourceRow[]> {
    const accounts = await getAwsAccounts(tenantId, accountId);
    if (accounts.length === 0) return [];

    const aliasByAccount = new Map(accounts.map((a) => [a.account_id, a.alias || a.account_id]));
    const aliasOf = (id: string) => aliasByAccount.get(id) || id;

    const perAccount = await Promise.all(accounts.map(async (account) => {
        let creds: AwsTempCredentials;
        try {
            creds = await assumeRole(
                account.role_arn,
                decryptExternalId(account.external_id_encrypted),
                `FinOps-${tenantId.slice(0, 8)}`
            );
        } catch (e) {
            console.warn(`[AwsResourceInventory] AssumeRole fallo en ${account.account_id}:`, (e as Error).message);
            return [] as AwsInventoryResourceRow[];
        }

        const regions = await getActiveRegions(tenantId, account.account_id);
        const perRegion = await Promise.all(regions.map(async (region) => {
            const mappings = await fetchRegionResources(taggingClientFor(region, creds), region, account.account_id);
            return mappings
                .map((m) => mapTaggedResource(m, aliasOf))
                .filter((r): r is AwsInventoryResourceRow => r !== null);
        }));
        return perRegion.flat();
    }));

    return perAccount.flat();
}

/**
 * Costo del mes en curso por ARN, desde `FocusLineItems`.
 *
 * Se consulta la base y no Cost Explorer: el dato ya está ingestado por el
 * camino CUR y Cost Explorer cobra por request. Un tenant sin CUR verá 0, que
 * es honesto —Cost Explorer no desglosa por recurso— y no un número inventado.
 */
export async function getAwsResourceCosts(tenantId: string, arns: string[]): Promise<Map<string, number>> {
    const result = new Map<string, number>();
    if (arns.length === 0) return result;

    const placeholders = arns.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT ResourceId, SUM(COALESCE(EffectiveCost, BilledCost, 0)) AS cost
           FROM FocusLineItems
          WHERE tenant_id = ? AND ProviderName = 'AWS'
            AND ResourceId IN (${placeholders})
            AND ChargePeriodStart >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
          GROUP BY ResourceId`,
        [tenantId, ...arns]
    );

    for (const r of (Array.isArray(rows) ? rows : []) as Array<{ ResourceId?: string; cost?: unknown }>) {
        if (r.ResourceId) result.set(r.ResourceId.toLowerCase(), Number(r.cost ?? 0));
    }
    return result;
}

export interface AwsSearchFilters {
    accountId?: string;
    region?: string;
    tagKey?: string;
    search?: string;
    page: number;
    pageSize: number;
}

/**
 * Búsqueda paginada de recursos.
 *
 * La paginación es **en memoria** y no en la API. `GetResources` sólo pagina
 * secuencialmente con un token opaco: no admite saltar a la página N, así que
 * servir la página 5 exigiría igual recorrer las cuatro anteriores. Como el
 * resultado se cachea aguas arriba, traerlo entero una vez y paginar acá es más
 * barato que reconstruir el recorrido en cada request.
 */
export async function searchAwsResources(tenantId: string, filters: AwsSearchFilters) {
    const all = await getAwsAllResources(tenantId, filters.accountId || null);

    const search = filters.search?.toLowerCase();
    const filtered = all.filter((r) => {
        if (filters.region && r.resourceGroup !== filters.region) return false;
        if (filters.tagKey && !r.tags[filters.tagKey]) return false;
        if (search && !r.name.toLowerCase().includes(search)) return false;
        return true;
    });

    const sorted = filtered.sort((a, b) => a.name.localeCompare(b.name));
    const start = (filters.page - 1) * filters.pageSize;
    const pageRows = sorted.slice(start, start + filters.pageSize);

    const costMap = await getAwsResourceCosts(tenantId, pageRows.map((r) => r.id));

    const costCenters = new Set<string>();
    for (const r of filtered) {
        const cc = r.tags.CostCenter || r.tags.costcenter;
        if (cc) costCenters.add(cc);
    }

    return {
        rows: pageRows.map((r) => ({ ...r, periodCost: costMap.get(r.id.toLowerCase()) || 0 })),
        total: filtered.length,
        kpis: {
            costGroups: costCenters.size,
            subscriptions: new Set(filtered.map((r) => r.subscriptionId)).size,
            // En AWS el equivalente del resource group es la region.
            resourceGroups: new Set(filtered.map((r) => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: filtered.length,
        },
    };
}

/** Distribución del inventario por tipo y por cuenta. */
export async function getAwsInventoryDistribution(tenantId: string, accountId?: string | null) {
    const all = await getAwsAllResources(tenantId, accountId);

    const byTypeMap = new Map<string, number>();
    const bySubMap = new Map<string, { name: string; count: number }>();
    const owners = new Set<string>();
    const costCenters = new Set<string>();

    for (const r of all) {
        const short = r.type.split('/').pop() || r.type;
        byTypeMap.set(short, (byTypeMap.get(short) || 0) + 1);

        const sub = bySubMap.get(r.subscriptionId);
        if (sub) sub.count += 1;
        else bySubMap.set(r.subscriptionId, { name: r.subscriptionName, count: 1 });

        const owner = r.tags.Owner || r.tags.owner;
        if (owner) owners.add(owner);
        const cc = r.tags.CostCenter || r.tags.costcenter;
        if (cc) costCenters.add(cc);
    }

    return {
        byType: [...byTypeMap.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 15)
            .map(([type, count]) => ({ type, count })),
        bySubscription: [...bySubMap.entries()].map(([subscriptionId, v]) => ({
            subscriptionId,
            subscriptionName: v.name,
            count: v.count,
        })),
        kpis: {
            costGroups: costCenters.size,
            subscriptions: bySubMap.size,
            resourceGroups: new Set(all.map((r) => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: all.length,
            owners: owners.size,
        },
    };
}

/**
 * "Creado por", derivado de las etiquetas.
 *
 * Mismo criterio que el lado Azure: el creador real vive en CloudTrail (allá,
 * en el Activity Log), una ingesta aparte y con retención de 90 días. Se usa la
 * etiqueta `CreatedBy`/`Owner` como proxy, que muchas organizaciones aplican
 * automáticamente en su pipeline de aprovisionamiento. No es 1:1 con el evento
 * de creación, pero es un dato real y no una invención.
 */
export async function getAwsCreatedByAggregation(tenantId: string, accountId?: string | null) {
    const all = await getAwsAllResources(tenantId, accountId);

    const byCreator = new Map<string, { resources: number; regions: Set<string>; accounts: Set<string> }>();
    const costCenters = new Set<string>();

    for (const r of all) {
        const cc = r.tags.CostCenter || r.tags.costcenter;
        if (cc) costCenters.add(cc);

        const creator = r.tags.CreatedBy || r.tags.createdBy || r.tags.Owner || r.tags.owner;
        if (!creator) continue;
        let entry = byCreator.get(creator);
        if (!entry) {
            entry = { resources: 0, regions: new Set(), accounts: new Set() };
            byCreator.set(creator, entry);
        }
        entry.resources += 1;
        entry.regions.add(r.resourceGroup);
        entry.accounts.add(r.subscriptionId);
    }

    return {
        rows: [...byCreator.entries()]
            .map(([userName, v]) => ({
                userName,
                resources: v.resources,
                resourceGroups: v.regions.size,
                subscriptions: v.accounts.size,
            }))
            .sort((a, b) => b.resources - a.resources),
        kpis: {
            createdBy: byCreator.size,
            costGroups: costCenters.size,
            subscriptions: new Set(all.map((r) => r.subscriptionId)).size,
            resourceGroups: new Set(all.map((r) => `${r.subscriptionId}/${r.resourceGroup}`)).size,
            resources: all.length,
        },
    };
}

/** Claves de etiqueta distintas presentes en el inventario. */
export async function getAwsDistinctTagKeys(tenantId: string, accountId?: string | null): Promise<string[]> {
    const all = await getAwsAllResources(tenantId, accountId);
    const keys = new Set<string>();
    for (const r of all) {
        for (const k of Object.keys(r.tags)) {
            // `aws:` es el prefijo reservado de las etiquetas que genera AWS
            // (aws:cloudformation:stack-name, etc.). No son etiquetas de
            // gobernanza del cliente y ensuciarian el selector.
            if (!k.startsWith('aws:')) keys.add(k);
        }
    }
    return [...keys].sort().slice(0, 12);
}

/**
 * Costo por valor de una etiqueta.
 *
 * Sale de `FocusLineItems.Tags`, donde el mapper del CUR persiste las etiquetas
 * de cada línea. No se usa el group-by por etiqueta de Cost Explorer porque
 * cobra por request y el dato ya está en casa.
 */
export async function getAwsCostByTagKey(
    tenantId: string,
    tagKey: string
): Promise<Array<{ value: string; cost: number }>> {
    // `tagKey` viene del cliente y se interpola en un JSON path. Se restringe a
    // los caracteres que AWS admite en una clave de etiqueta, sin comillas ni
    // '$', para que no pueda salirse de la expresion.
    if (!/^[\w.:/=+@-]{1,128}$/.test(tagKey)) return [];

    const [rows] = await pool.query(
        `SELECT JSON_UNQUOTE(JSON_EXTRACT(Tags, ?)) AS value,
                SUM(COALESCE(EffectiveCost, BilledCost, 0)) AS cost
           FROM FocusLineItems
          WHERE tenant_id = ? AND ProviderName = 'AWS'
            AND Tags IS NOT NULL
            AND ChargePeriodStart >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
          GROUP BY value
         HAVING value IS NOT NULL
          ORDER BY cost DESC
          LIMIT 20`,
        [`$."${tagKey}"`, tenantId]
    );

    return (Array.isArray(rows) ? rows : [])
        .map((r) => {
            const row = r as { value?: unknown; cost?: unknown };
            return { value: String(row.value ?? ''), cost: Number(row.cost ?? 0) };
        })
        .filter((r) => r.value !== '');
}
