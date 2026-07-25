/**
 * Presupuestos nativos de AWS Budgets.
 *
 * Es el equivalente de los Consumption Budgets de Azure que lee
 * `getNativeBudgets`: presupuestos que el cliente definió en la consola de su
 * proveedor, no los que crea dentro de esta plataforma (esos viven en la tabla
 * `Budgets` y son agnósticos).
 *
 * Diferencias de AWS que condicionan el diseño:
 *
 * - **AWS Budgets es un servicio global**: el endpoint vive sólo en
 *   `us-east-1`. Consultar por región devolvería vacío en todas las demás.
 * - **Los presupuestos cuelgan de la cuenta**, y `DescribeBudgets` exige el
 *   account ID del dueño. No hay un scope jerárquico como el management group
 *   de Azure: para ver los de toda la organización hay que recorrer cuenta por
 *   cuenta.
 * - **`CalculatedSpend` puede venir ausente** en un presupuesto recién creado,
 *   igual que el `currentSpend` de Azure. Se aplica el mismo criterio de Regla
 *   Cero que en el lado Azure: si AWS informa el gasto (aunque sea 0) esa es la
 *   verdad; si no lo informa y el presupuesto cubre la cuenta entera, se
 *   aproxima con el MTD; si está filtrado por servicio o etiqueta, se deja en 0
 *   en vez de inflarlo con el total de la cuenta.
 * - **Sólo se leen presupuestos de COSTO**. AWS Budgets también modela uso,
 *   cobertura y utilización de RI/Savings Plans, que se miden en horas o en
 *   porcentaje: mezclarlos con dinero en la misma tabla daría totales sin
 *   sentido.
 *
 * Permiso IAM mínimo: `budgets:DescribeBudgets` y `budgets:ViewBudget` sobre
 * `arn:aws:budgets::<account-id>:budget/*`. Es de sólo lectura y ya está
 * contemplado en el rol del tier Enterprise.
 */
import { BudgetsClient, DescribeBudgetsCommand, type Budget } from '@aws-sdk/client-budgets';
import { assumeRole, decryptExternalId, type AwsTempCredentials } from '@/lib/aws/sts';
import pool from '@/modules/storage/db';

/** AWS Budgets es global y sólo responde en us-east-1. */
const BUDGETS_ENDPOINT_REGION = 'us-east-1';

export interface AwsNativeBudget {
    subscriptionId: string;
    costCenter: string;
    budget: number;
    actual: number;
    estimated: boolean;
}

interface AwsAccountRow {
    account_id: string;
    alias: string | null;
    role_arn: string;
    external_id_encrypted: string;
}

/**
 * Gasto del mes en curso para una cuenta, desde el snapshot local.
 *
 * No se llama a Cost Explorer: factura por consulta y el dato ya está
 * ingestado. Es el analogo de `fetchMtdCostForSub` del lado Azure.
 */
export async function fetchMtdCostForAccount(tenantId: string, accountId: string): Promise<number> {
    try {
        const [rows] = await pool.query(
            `SELECT SUM(COALESCE(EffectiveCost, cost_usd, 0)) AS mtd
               FROM CostSnapshots
              WHERE tenant_id = ?
                AND subscription_id = ?
                AND DATE(COALESCE(ChargePeriodStart, date)) >= DATE_FORMAT(CURDATE(), '%Y-%m-01')
                AND DATE(COALESCE(ChargePeriodStart, date)) <= CURDATE()`,
            [tenantId, accountId]
        );
        const val = Number((Array.isArray(rows) ? (rows[0] as { mtd?: unknown }) : {})?.mtd ?? 0);
        return val > 0 ? val : 0;
    } catch {
        return 0;
    }
}

/**
 * ¿El presupuesto cubre la cuenta entera?
 *
 * `CostFilters` vacío significa "todo el gasto de la cuenta". Si trae filtros
 * (por servicio, region o etiqueta) el presupuesto es parcial y su gasto no se
 * puede aproximar con el MTD de la cuenta sin exagerarlo.
 */
export function coversWholeAccount(budget: Budget): boolean {
    const filters = budget.CostFilters;
    if (!filters) return true;
    return Object.values(filters).every((v) => !v || v.length === 0);
}

/** Normaliza un presupuesto de AWS al contrato que ya consume la UI. */
export async function mapAwsBudget(
    tenantId: string,
    accountId: string,
    budget: Budget
): Promise<AwsNativeBudget | null> {
    if (budget.BudgetType !== 'COST') return null;

    const limit = Number(budget.BudgetLimit?.Amount ?? 0);
    const rawSpend = budget.CalculatedSpend?.ActualSpend?.Amount;
    const hasActualSpend = rawSpend !== null && rawSpend !== undefined && rawSpend !== '';

    let actual: number;
    let estimated = false;
    if (hasActualSpend) {
        actual = Number(rawSpend);
    } else if (coversWholeAccount(budget)) {
        actual = await fetchMtdCostForAccount(tenantId, accountId);
        estimated = actual > 0;
    } else {
        actual = 0;
    }

    return {
        subscriptionId: accountId,
        costCenter: budget.BudgetName ?? accountId,
        budget: limit,
        actual,
        estimated,
    };
}

/**
 * Presupuestos nativos de una cuenta AWS.
 *
 * @param accountId Cuenta a consultar; debe pertenecer al tenant (lo garantiza
 *                  la consulta a `AwsAccounts`).
 */
export async function getAwsNativeBudgets(tenantId: string, accountId: string): Promise<AwsNativeBudget[]> {
    const [rows] = await pool.query(
        `SELECT account_id, alias, role_arn, external_id_encrypted
           FROM AwsAccounts
          WHERE tenant_id = ? AND account_id = ?`,
        [tenantId, accountId]
    );
    const account = (Array.isArray(rows) ? rows : [])[0] as AwsAccountRow | undefined;
    if (!account) return [];

    let creds: AwsTempCredentials;
    try {
        creds = await assumeRole(
            account.role_arn,
            decryptExternalId(account.external_id_encrypted),
            `FinOps-${tenantId.slice(0, 8)}`
        );
    } catch (e) {
        console.warn(`[AwsBudgets] AssumeRole fallo en ${accountId}:`, (e as Error).message);
        return [];
    }

    const client = new BudgetsClient({
        region: BUDGETS_ENDPOINT_REGION,
        credentials: {
            accessKeyId: creds.accessKeyId,
            secretAccessKey: creds.secretAccessKey,
            sessionToken: creds.sessionToken,
        },
    });

    const out: AwsNativeBudget[] = [];
    try {
        let nextToken: string | undefined;
        do {
            const res = await client.send(new DescribeBudgetsCommand({
                AccountId: accountId,
                MaxResults: 100,
                NextToken: nextToken,
            }));
            for (const b of res.Budgets ?? []) {
                const mapped = await mapAwsBudget(tenantId, accountId, b);
                if (mapped) out.push(mapped);
            }
            nextToken = res.NextToken;
        } while (nextToken);
    } catch (e) {
        // Sin el permiso `budgets:DescribeBudgets` la seccion queda vacia, pero
        // el resto de la pagina de presupuestos —los definidos en la
        // plataforma— tiene que seguir cargando.
        console.warn(`[AwsBudgets] DescribeBudgets fallo en ${accountId}:`, (e as Error).message);
    }

    return out;
}
