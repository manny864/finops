/**
 * Inventario de recursos AWS: la contraparte de Azure Resource Graph.
 *
 * Azure resuelve el inventario con una sola consulta KQL contra Resource Graph,
 * que ya es global a todas las suscripciones. AWS no tiene ese equivalente
 * gratuito y transversal (Config Advanced Query existe, pero hay que habilitar
 * Config por region y se factura por item registrado), asi que aca el inventario
 * se arma llamando a las APIs de EC2 cuenta por cuenta y region por region.
 *
 * Para no barrer las ~30 regiones de AWS en cada request, las regiones a
 * consultar salen de `CostSnapshots.resource_group`, que en AWS guarda la
 * REGION (ver la convencion documentada en el handoff). Si una region no genero
 * ni un dolar de gasto, no puede tener recursos con costo que valga la pena
 * auditar.
 *
 * RBAC (principio de menor privilegio, AGENTS.md #1): solo requiere permisos de
 * LECTURA sobre EC2 — `ec2:DescribeInstances`, `ec2:DescribeVolumes`,
 * `ec2:DescribeAddresses`, `ec2:DescribeSnapshots`. Los tres primeros ya los
 * concede el rol de onboarding; `DescribeSnapshots` se suma en el tier que
 * habilita la limpieza. No se pide ninguna accion de escritura: la remediacion
 * vive en su propio flujo con aprobacion.
 */

import { EC2Client, DescribeInstancesCommand, DescribeVolumesCommand, DescribeAddressesCommand, DescribeSnapshotsCommand } from '@aws-sdk/client-ec2';
import type { Volume, Address, Snapshot, Instance } from '@aws-sdk/client-ec2';
import { Decimal } from 'decimal.js';
import pool from '@/modules/storage/db';
import { assumeRole, decryptExternalId, type AwsTempCredentials } from '@/lib/aws/sts';

/** Item de inventario, normalizado al mismo contrato que consume la UI de Azure. */
export interface AwsInventoryItem {
    resourceId: string;
    name: string;
    resourceType: string;
    /** Region AWS. Se mapea a `resourceGroup` para reutilizar la UI de Azure. */
    region: string;
    accountId: string;
    monthlyCost: number;
    tags: Record<string, string>;
    /** Motivo por el que el recurso se considera desperdicio. */
    reason?: string;
    state?: string;
    sizeGB?: number;
}

/**
 * Precio de almacenamiento EBS en USD por GB-mes, us-east-1.
 *
 * Es una tabla estatica a proposito: la Pricing API de AWS cobra por request y
 * agrega latencia a un endpoint que ya es multi-region. Estos precios se usan
 * SOLO para estimar el ahorro de un recurso huerfano (que por definicion no
 * tiene todavia una linea propia en el CUR que podamos leer). El costo real
 * sigue saliendo del CUR/Cost Explorer.
 *
 * Regla Cero (AGENTS.md): son strings, no floats, y se operan con Decimal.
 */
const EBS_PRICE_PER_GB_MONTH: Record<string, string> = {
    gp3: '0.08',
    gp2: '0.10',
    io1: '0.125',
    io2: '0.125',
    st1: '0.045',
    sc1: '0.015',
    standard: '0.05',
};

/** Snapshot EBS: USD por GB-mes. */
const SNAPSHOT_PRICE_PER_GB_MONTH = '0.05';

/**
 * IP elastica sin asociar: USD/hora que AWS cobra por tenerla reservada y
 * ociosa. Desde 2024 AWS cobra tambien las IPv4 publicas en uso, pero la que
 * nos interesa como desperdicio puro es la que no esta asociada a nada.
 */
const IDLE_EIP_PRICE_PER_HOUR = '0.005';
const HOURS_PER_MONTH = '730';

/** Antiguedad a partir de la cual un snapshot se marca como candidato a borrar. */
const SNAPSHOT_STALE_DAYS = 90;

interface AwsAccountRow {
    account_id: string;
    alias: string | null;
    role_arn: string;
    external_id_encrypted: string;
}

/** Cuentas AWS configuradas para el tenant, opcionalmente filtradas a una. */
async function getAwsAccounts(tenantId: string, accountId?: string | null): Promise<AwsAccountRow[]> {
    const filterOne = accountId && accountId.toLowerCase() !== 'all';
    const [rows] = await pool.query(
        `SELECT account_id, alias, role_arn, external_id_encrypted
           FROM AwsAccounts
          WHERE tenant_id = ?${filterOne ? ' AND account_id = ?' : ''}`,
        filterOne ? [tenantId, accountId] : [tenantId]
    );
    return Array.isArray(rows) ? (rows as AwsAccountRow[]) : [];
}

/**
 * Regiones con gasto registrado para la cuenta. En AWS `resource_group` guarda
 * la region (convencion del sync, ver handoff). Si no hay historial todavia
 * —tenant recien dado de alta— cae a la region por defecto para no devolver
 * vacio silenciosamente.
 */
export async function getActiveRegions(tenantId: string, accountId: string): Promise<string[]> {
    const [rows] = await pool.query(
        `SELECT DISTINCT resource_group AS region
           FROM CostSnapshots
          WHERE tenant_id = ? AND subscription_id = ?
            AND resource_group IS NOT NULL AND resource_group <> ''
            AND date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)`,
        [tenantId, accountId]
    );
    const regions = Array.isArray(rows)
        ? (rows as { region: string }[])
            .map((r) => r.region)
            // El CUR trae filas sin region para servicios globales (IAM, Route53
            // o los cargos de soporte). No son regiones consultables.
            .filter((r) => /^[a-z]{2}(-gov)?-[a-z]+-\d$/.test(r))
        : [];
    return regions.length > 0 ? regions : [process.env.AWS_DEFAULT_REGION || 'us-east-1'];
}

function ec2For(region: string, creds: AwsTempCredentials): EC2Client {
    return new EC2Client({
        region,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
        },
    });
}

function tagsOf(tags?: { Key?: string; Value?: string }[]): Record<string, string> {
    const out: Record<string, string> = {};
    for (const t of tags || []) if (t.Key) out[t.Key] = t.Value || '';
    return out;
}

function nameOf(tags: Record<string, string>, fallback: string): string {
    return tags.Name || tags.name || fallback;
}

/** Costo mensual de un volumen EBS segun su tipo y tamaño. */
export function ebsMonthlyCost(volumeType: string | undefined, sizeGB: number | undefined): Decimal {
    const price = EBS_PRICE_PER_GB_MONTH[(volumeType || 'gp2').toLowerCase()] || EBS_PRICE_PER_GB_MONTH.gp2;
    return new Decimal(price).mul(new Decimal(sizeGB || 0));
}

/** Costo mensual de una IP elastica ociosa. */
export function idleEipMonthlyCost(): Decimal {
    return new Decimal(IDLE_EIP_PRICE_PER_HOUR).mul(HOURS_PER_MONTH);
}

/** Costo mensual de un snapshot EBS. */
export function snapshotMonthlyCost(sizeGB: number | undefined): Decimal {
    return new Decimal(SNAPSHOT_PRICE_PER_GB_MONTH).mul(new Decimal(sizeGB || 0));
}

function toItem(partial: Omit<AwsInventoryItem, 'monthlyCost'> & { monthlyCost: Decimal }): AwsInventoryItem {
    return { ...partial, monthlyCost: partial.monthlyCost.toDecimalPlaces(2).toNumber() };
}

/** Volumenes EBS en estado `available`: creados o desprendidos y nunca borrados. */
export function volumesToZombies(volumes: Volume[], region: string, accountId: string): AwsInventoryItem[] {
    return volumes
        .filter((v) => v.State === 'available')
        .map((v) => {
            const tags = tagsOf(v.Tags);
            return toItem({
                resourceId: v.VolumeId || '',
                name: nameOf(tags, v.VolumeId || ''),
                resourceType: 'aws.ec2/volumes',
                region,
                accountId,
                monthlyCost: ebsMonthlyCost(v.VolumeType, v.Size),
                tags,
                reason: 'unattachedVolumes',
                state: v.State,
                sizeGB: v.Size,
            });
        });
}

/** IPs elasticas sin asociacion: AWS las cobra por estar reservadas y ociosas. */
export function addressesToZombies(addresses: Address[], region: string, accountId: string): AwsInventoryItem[] {
    return addresses
        .filter((a) => !a.AssociationId && !a.InstanceId)
        .map((a) => {
            const tags = tagsOf(a.Tags);
            return toItem({
                resourceId: a.AllocationId || a.PublicIp || '',
                name: nameOf(tags, a.PublicIp || ''),
                resourceType: 'aws.ec2/elastic-ips',
                region,
                accountId,
                monthlyCost: idleEipMonthlyCost(),
                tags,
                reason: 'unattachedPublicIps',
            });
        });
}

/** Snapshots mas viejos que el umbral. */
export function snapshotsToZombies(snapshots: Snapshot[], region: string, accountId: string, now: Date): AwsInventoryItem[] {
    const cutoff = now.getTime() - SNAPSHOT_STALE_DAYS * 24 * 60 * 60 * 1000;
    return snapshots
        .filter((s) => s.StartTime instanceof Date && s.StartTime.getTime() < cutoff)
        .map((s) => {
            const tags = tagsOf(s.Tags);
            return toItem({
                resourceId: s.SnapshotId || '',
                name: nameOf(tags, s.SnapshotId || ''),
                resourceType: 'aws.ec2/snapshots',
                region,
                accountId,
                monthlyCost: snapshotMonthlyCost(s.VolumeSize),
                tags,
                reason: 'oldSnapshots',
                sizeGB: s.VolumeSize,
            });
        });
}

/**
 * Instancias detenidas. En AWS una instancia `stopped` no factura computo, pero
 * sus volumenes EBS se siguen cobrando enteros: ese es el desperdicio real y es
 * lo que se reporta como costo.
 */
export function stoppedInstancesToZombies(
    instances: Instance[],
    volumesById: Map<string, Volume>,
    region: string,
    accountId: string
): AwsInventoryItem[] {
    return instances
        .filter((i) => i.State?.Name === 'stopped')
        .map((i) => {
            const tags = tagsOf(i.Tags);
            let cost = new Decimal(0);
            for (const bdm of i.BlockDeviceMappings || []) {
                const vol = bdm.Ebs?.VolumeId ? volumesById.get(bdm.Ebs.VolumeId) : undefined;
                if (vol) cost = cost.plus(ebsMonthlyCost(vol.VolumeType, vol.Size));
            }
            return toItem({
                resourceId: i.InstanceId || '',
                name: nameOf(tags, i.InstanceId || ''),
                resourceType: 'aws.ec2/instances',
                region,
                accountId,
                monthlyCost: cost,
                tags,
                reason: 'longStoppedInstances',
                state: i.State?.Name,
            });
        });
}

/** Recorre las paginas de una API de EC2 acumulando resultados. */
async function paginate<T>(fetchPage: (token?: string) => Promise<{ items: T[]; next?: string }>): Promise<T[]> {
    const out: T[] = [];
    let token: string | undefined;
    do {
        const page = await fetchPage(token);
        out.push(...page.items);
        token = page.next;
    } while (token);
    return out;
}

/**
 * Recursos ociosos de una cuenta en una region.
 *
 * Cada familia de recursos se pide en paralelo pero se aisla con `catch`: si el
 * rol del cliente todavia no tiene `ec2:DescribeSnapshots` (tier que no lo
 * incluye, o una politica mas restrictiva), se pierde ESA familia y no la
 * respuesta entera.
 */
async function scanRegion(
    tenantId: string,
    account: AwsAccountRow,
    region: string,
    creds: AwsTempCredentials,
    now: Date
): Promise<AwsInventoryItem[]> {
    const ec2 = ec2For(region, creds);
    const accountId = account.account_id;

    const volumesP = paginate<Volume>(async (t) => {
        const r = await ec2.send(new DescribeVolumesCommand({ NextToken: t, MaxResults: t || undefined ? 500 : 500 }));
        return { items: r.Volumes || [], next: r.NextToken };
    }).catch((e) => {
        console.warn(`[AwsInventory] ${accountId}/${region} DescribeVolumes fallo:`, (e as Error).message);
        return [] as Volume[];
    });

    const addressesP = ec2.send(new DescribeAddressesCommand({}))
        .then((r) => r.Addresses || [])
        .catch((e) => {
            console.warn(`[AwsInventory] ${accountId}/${region} DescribeAddresses fallo:`, (e as Error).message);
            return [] as Address[];
        });

    // `OwnerIds: ['self']` es imprescindible: sin el, AWS devuelve tambien los
    // snapshots publicos de toda la comunidad (decenas de miles).
    const snapshotsP = paginate<Snapshot>(async (t) => {
        const r = await ec2.send(new DescribeSnapshotsCommand({ OwnerIds: ['self'], NextToken: t, MaxResults: 500 }));
        return { items: r.Snapshots || [], next: r.NextToken };
    }).catch((e) => {
        console.warn(`[AwsInventory] ${accountId}/${region} DescribeSnapshots fallo:`, (e as Error).message);
        return [] as Snapshot[];
    });

    const instancesP = paginate<Instance>(async (t) => {
        const r = await ec2.send(new DescribeInstancesCommand({ NextToken: t, MaxResults: 500 }));
        const items = (r.Reservations || []).flatMap((res) => res.Instances || []);
        return { items, next: r.NextToken };
    }).catch((e) => {
        console.warn(`[AwsInventory] ${accountId}/${region} DescribeInstances fallo:`, (e as Error).message);
        return [] as Instance[];
    });

    const [volumes, addresses, snapshots, instances] = await Promise.all([volumesP, addressesP, snapshotsP, instancesP]);

    const volumesById = new Map<string, Volume>();
    for (const v of volumes) if (v.VolumeId) volumesById.set(v.VolumeId, v);

    return [
        ...volumesToZombies(volumes, region, accountId),
        ...addressesToZombies(addresses, region, accountId),
        ...snapshotsToZombies(snapshots, region, accountId, now),
        ...stoppedInstancesToZombies(instances, volumesById, region, accountId),
    ];
}

/**
 * Recursos ociosos de todas las cuentas AWS del tenant.
 *
 * @param accountId Limita a una cuenta; `null`/'all' recorre todas.
 */
export async function getAwsZombies(tenantId: string, accountId?: string | null): Promise<AwsInventoryItem[]> {
    const accounts = await getAwsAccounts(tenantId, accountId);
    if (accounts.length === 0) return [];

    const now = new Date();
    const perAccount = await Promise.all(
        accounts.map(async (account) => {
            let creds: AwsTempCredentials;
            try {
                creds = await assumeRole(
                    account.role_arn,
                    decryptExternalId(account.external_id_encrypted),
                    `FinOps-${tenantId.slice(0, 8)}`
                );
            } catch (e) {
                // Un rol revocado en una cuenta no puede dejar sin auditoria a
                // las demas cuentas del tenant.
                console.warn(`[AwsInventory] AssumeRole fallo en ${account.account_id}:`, (e as Error).message);
                return [];
            }
            const regions = await getActiveRegions(tenantId, account.account_id);
            const perRegion = await Promise.all(
                regions.map((region) => scanRegion(tenantId, account, region, creds, now)
                    .catch((e) => {
                        console.warn(`[AwsInventory] region ${region} fallo:`, (e as Error).message);
                        return [] as AwsInventoryItem[];
                    }))
            );
            return perRegion.flat();
        })
    );

    return perAccount.flat().sort((a, b) => b.monthlyCost - a.monthlyCost);
}
