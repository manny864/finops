/**
 * Presupuestos nativos de AWS.
 *
 * Lo que protege: que el gasto informado por AWS Budgets se respete tal cual y
 * que, cuando AWS no lo informe, sólo se aproxime con el MTD si el presupuesto
 * cubre la cuenta entera. Aproximarlo en un presupuesto filtrado inflaría el
 * consumo y dispararía alertas falsas de sobregiro.
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    mockQuery: vi.fn(),
    mockSend: vi.fn(),
    mockAssumeRole: vi.fn(),
}));

vi.mock('@/modules/storage/db', () => ({
    default: { query: mocks.mockQuery },
    initializeDatabase: vi.fn(),
}));

vi.mock('@/lib/aws/sts', () => ({
    assumeRole: mocks.mockAssumeRole,
    decryptExternalId: (s: string) => s,
}));

vi.mock('@aws-sdk/client-budgets', async () => {
    const actual = await vi.importActual<typeof import('@aws-sdk/client-budgets')>('@aws-sdk/client-budgets');
    return {
        ...actual,
        BudgetsClient: class {
            send = mocks.mockSend;
        },
    };
});

const { getAwsNativeBudgets, mapAwsBudget, coversWholeAccount, fetchMtdCostForAccount } =
    await import('@/modules/collectors/aws/awsBudgetService');

const TENANT = 'tenant-aws-1';
const ACCOUNT = '123456789012';

beforeEach(() => {
    vi.clearAllMocks();
    mocks.mockAssumeRole.mockResolvedValue({
        accessKeyId: 'AKIA', secretAccessKey: 's', sessionToken: 't',
    });
});

describe('coversWholeAccount', () => {
    it('sin filtros cubre toda la cuenta', () => {
        expect(coversWholeAccount({} as never)).toBe(true);
        expect(coversWholeAccount({ CostFilters: {} } as never)).toBe(true);
        // Una clave presente pero vacía no restringe nada.
        expect(coversWholeAccount({ CostFilters: { Service: [] } } as never)).toBe(true);
    });

    it('con filtros el presupuesto es parcial', () => {
        expect(coversWholeAccount({ CostFilters: { Service: ['AmazonEC2'] } } as never)).toBe(false);
        expect(coversWholeAccount({ CostFilters: { TagKeyValue: ['user:Team$data'] } } as never)).toBe(false);
    });
});

describe('mapAwsBudget', () => {
    it('usa el gasto informado por AWS aunque sea cero', async () => {
        mocks.mockQuery.mockResolvedValue([[{ mtd: 999 }]]);

        const r = await mapAwsBudget(TENANT, ACCOUNT, {
            BudgetName: 'mensual', BudgetType: 'COST',
            BudgetLimit: { Amount: '1000', Unit: 'USD' },
            CalculatedSpend: { ActualSpend: { Amount: '0', Unit: 'USD' } },
        } as never);

        // Un cero informado es un dato, no un hueco: aproximarlo con el MTD
        // mostraría gasto donde AWS afirma que no lo hay.
        expect(r).toMatchObject({ budget: 1000, actual: 0, estimated: false });
        expect(mocks.mockQuery).not.toHaveBeenCalled();
    });

    it('aproxima con el MTD sólo si el presupuesto cubre la cuenta entera', async () => {
        mocks.mockQuery.mockResolvedValue([[{ mtd: '742.50' }]]);

        const r = await mapAwsBudget(TENANT, ACCOUNT, {
            BudgetName: 'total', BudgetType: 'COST',
            BudgetLimit: { Amount: '2000', Unit: 'USD' },
        } as never);

        expect(r).toMatchObject({ actual: 742.5, estimated: true });
    });

    it('no aproxima un presupuesto filtrado', async () => {
        mocks.mockQuery.mockResolvedValue([[{ mtd: '742.50' }]]);

        const r = await mapAwsBudget(TENANT, ACCOUNT, {
            BudgetName: 'solo-ec2', BudgetType: 'COST',
            BudgetLimit: { Amount: '500', Unit: 'USD' },
            CostFilters: { Service: ['AmazonEC2'] },
        } as never);

        // Con el MTD de la cuenta entera, un presupuesto de EC2 aparecería
        // sobregirado aunque no lo esté.
        expect(r).toMatchObject({ actual: 0, estimated: false });
        expect(mocks.mockQuery).not.toHaveBeenCalled();
    });

    it('descarta los presupuestos que no son de costo', async () => {
        for (const tipo of ['USAGE', 'RI_UTILIZATION', 'SAVINGS_PLANS_COVERAGE']) {
            const r = await mapAwsBudget(TENANT, ACCOUNT, {
                BudgetName: tipo, BudgetType: tipo,
                BudgetLimit: { Amount: '80', Unit: 'Percent' },
            } as never);
            // Se miden en horas o en porcentaje: sumarlos junto a dinero daría
            // un total sin sentido.
            expect(r).toBeNull();
        }
    });
});

describe('fetchMtdCostForAccount', () => {
    it('devuelve 0 si la consulta falla en vez de propagar', async () => {
        mocks.mockQuery.mockRejectedValue(new Error('DB caída'));
        await expect(fetchMtdCostForAccount(TENANT, ACCOUNT)).resolves.toBe(0);
    });

    it('filtra por tenant y cuenta', async () => {
        mocks.mockQuery.mockResolvedValue([[{ mtd: 10 }]]);
        await fetchMtdCostForAccount(TENANT, ACCOUNT);
        const [sql, params] = mocks.mockQuery.mock.calls[0] as [string, unknown[]];
        expect(sql).toContain('tenant_id = ?');
        expect(params).toEqual([TENANT, ACCOUNT]);
    });
});

describe('getAwsNativeBudgets', () => {
    it('devuelve vacío si la cuenta no pertenece al tenant', async () => {
        mocks.mockQuery.mockResolvedValue([[]]);

        const r = await getAwsNativeBudgets(TENANT, ACCOUNT);

        // Sin fila en AwsAccounts no se asume ningún rol: es lo que impide
        // consultar la cuenta de otro tenant pasando su account ID.
        expect(r).toEqual([]);
        expect(mocks.mockAssumeRole).not.toHaveBeenCalled();
    });

    it('pagina hasta agotar el NextToken', async () => {
        mocks.mockQuery.mockResolvedValue([[{
            account_id: ACCOUNT, alias: 'prod', role_arn: 'arn:aws:iam::123456789012:role/R', external_id_encrypted: 'x',
        }]]);
        mocks.mockSend
            .mockResolvedValueOnce({
                Budgets: [{ BudgetName: 'a', BudgetType: 'COST', BudgetLimit: { Amount: '100' }, CalculatedSpend: { ActualSpend: { Amount: '10' } } }],
                NextToken: 'p2',
            })
            .mockResolvedValueOnce({
                Budgets: [{ BudgetName: 'b', BudgetType: 'COST', BudgetLimit: { Amount: '200' }, CalculatedSpend: { ActualSpend: { Amount: '20' } } }],
            });

        const r = await getAwsNativeBudgets(TENANT, ACCOUNT);

        expect(mocks.mockSend).toHaveBeenCalledTimes(2);
        expect(r.map(b => b.costCenter)).toEqual(['a', 'b']);
        expect(r[0].subscriptionId).toBe(ACCOUNT);
    });

    it('sin permiso de lectura devuelve vacío en vez de romper la página', async () => {
        mocks.mockQuery.mockResolvedValue([[{
            account_id: ACCOUNT, alias: 'prod', role_arn: 'arn:aws:iam::123456789012:role/R', external_id_encrypted: 'x',
        }]]);
        mocks.mockSend.mockRejectedValue(new Error('AccessDeniedException'));

        // El resto de la página —los presupuestos definidos en la plataforma—
        // tiene que seguir cargando.
        await expect(getAwsNativeBudgets(TENANT, ACCOUNT)).resolves.toEqual([]);
    });

    it('un AssumeRole revocado no propaga el error', async () => {
        mocks.mockQuery.mockResolvedValue([[{
            account_id: ACCOUNT, alias: 'prod', role_arn: 'arn:aws:iam::123456789012:role/R', external_id_encrypted: 'x',
        }]]);
        mocks.mockAssumeRole.mockRejectedValue(new Error('AccessDenied'));

        await expect(getAwsNativeBudgets(TENANT, ACCOUNT)).resolves.toEqual([]);
        expect(mocks.mockSend).not.toHaveBeenCalled();
    });
});
