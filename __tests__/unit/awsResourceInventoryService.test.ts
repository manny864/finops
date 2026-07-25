// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryMock = vi.fn();
vi.mock('@/modules/storage/db', () => {
    const stub = { query: (...a: unknown[]) => queryMock(...a) };
    return { pool: stub, default: stub };
});
vi.mock('@/lib/aws/sts', () => ({ assumeRole: vi.fn(), decryptExternalId: vi.fn() }));

import {
    parseArn,
    resourceDisplayName,
    mapTaggedResource,
    getAwsCostByTagKey,
} from '@/modules/collectors/aws/awsResourceInventoryService';

const alias = (id: string) => (id === '123456789012' ? 'produccion' : id);

describe('parseArn', () => {
    it('descompone un ARN con separador de barra', () => {
        const r = parseArn('arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123');
        expect(r).toEqual({
            service: 'ec2',
            region: 'us-east-1',
            accountId: '123456789012',
            resourceType: 'instance',
            resourceId: 'i-0abc123',
        });
    });

    it('descompone un ARN con separador de dos puntos', () => {
        const r = parseArn('arn:aws:lambda:eu-west-1:123456789012:function:mi-funcion');
        expect(r?.resourceType).toBe('function');
        expect(r?.resourceId).toBe('mi-funcion');
    });

    it('trata el servicio como tipo cuando el ARN no trae separador (S3)', () => {
        // `arn:aws:s3:::mi-bucket` no tiene region ni cuenta ni tipo: el bucket
        // es global y su nombre ocupa todo el ultimo campo.
        const r = parseArn('arn:aws:s3:::mi-bucket');
        expect(r).toEqual({
            service: 's3',
            region: '',
            accountId: '',
            resourceType: 's3',
            resourceId: 'mi-bucket',
        });
    });

    it('conserva los niveles intermedios de un id compuesto', () => {
        const r = parseArn('arn:aws:ecs:us-east-1:123456789012:service/mi-cluster/mi-servicio');
        expect(r?.resourceType).toBe('service');
        expect(r?.resourceId).toBe('mi-cluster/mi-servicio');
    });

    it('elige el separador que aparece primero', () => {
        const r = parseArn('arn:aws:rds:us-east-1:123456789012:db:mi-base/replica');
        expect(r?.resourceType).toBe('db');
        expect(r?.resourceId).toBe('mi-base/replica');
    });

    it('rechaza cadenas que no son ARNs', () => {
        expect(parseArn('i-0abc123')).toBeNull();
        expect(parseArn('arn:aws:ec2')).toBeNull();
        expect(parseArn('')).toBeNull();
    });
});

describe('resourceDisplayName', () => {
    it('prefiere la etiqueta Name', () => {
        expect(resourceDisplayName({ Name: 'web-01' }, 'i-0abc')).toBe('web-01');
    });

    it('acepta la variante en minuscula', () => {
        expect(resourceDisplayName({ name: 'web-01' }, 'i-0abc')).toBe('web-01');
    });

    it('cae al id del ARN cuando no hay etiqueta', () => {
        expect(resourceDisplayName({ Owner: 'ana' }, 'i-0abc')).toBe('i-0abc');
    });
});

describe('mapTaggedResource', () => {
    it('normaliza un recurso al contrato de la UI', () => {
        const row = mapTaggedResource(
            {
                ResourceARN: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123',
                Tags: [{ Key: 'Name', Value: 'web-01' }, { Key: 'Owner', Value: 'ana' }],
            },
            alias
        );
        expect(row).toEqual({
            id: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0abc123',
            name: 'web-01',
            type: 'aws.ec2/instance',
            subscriptionId: '123456789012',
            subscriptionName: 'produccion',
            // Convencion del proyecto: en AWS `resourceGroup` transporta la region.
            resourceGroup: 'us-east-1',
            tags: { Name: 'web-01', Owner: 'ana' },
            // La Tagging API no expone fecha de creacion; se informa null en vez
            // de inventar una.
            createdTime: null,
        });
    });

    it('marca como global un recurso sin region', () => {
        const row = mapTaggedResource({ ResourceARN: 'arn:aws:s3:::mi-bucket', Tags: [] }, alias);
        expect(row?.resourceGroup).toBe('global');
        expect(row?.type).toBe('aws.s3/s3');
    });

    it('tolera una etiqueta con valor vacio', () => {
        const row = mapTaggedResource(
            {
                ResourceARN: 'arn:aws:ec2:us-east-1:123456789012:volume/vol-1',
                Tags: [{ Key: 'Environment' }],
            },
            alias
        );
        expect(row?.tags).toEqual({ Environment: '' });
    });

    it('descarta un mapping sin ARN', () => {
        expect(mapTaggedResource({ Tags: [] }, alias)).toBeNull();
    });
});

describe('getAwsCostByTagKey', () => {
    beforeEach(() => {
        queryMock.mockReset();
        queryMock.mockResolvedValue([[]]);
    });

    it('rechaza una clave con caracteres fuera del alfabeto de AWS sin tocar la base', async () => {
        // La clave se interpola en un JSON path: una comilla doble o un '$'
        // permitirian salirse de la expresion.
        for (const key of ['a"b', '$.x', "a'b", 'a[0]', '', 'x'.repeat(129)]) {
            expect(await getAwsCostByTagKey('t1', key)).toEqual([]);
        }
        expect(queryMock).not.toHaveBeenCalled();
    });

    it('acepta las claves validas y arma el JSON path', async () => {
        await getAwsCostByTagKey('t1', 'aws:cloudformation:stack-name');
        expect(queryMock).toHaveBeenCalledTimes(1);
        const params = queryMock.mock.calls[0][1] as string[];
        expect(params[0]).toBe('$."aws:cloudformation:stack-name"');
        expect(params[1]).toBe('t1');
    });

    it('filtra el tenant y el proveedor en la consulta', async () => {
        await getAwsCostByTagKey('t1', 'Environment');
        const sql = queryMock.mock.calls[0][0] as string;
        expect(sql).toContain('tenant_id = ?');
        expect(sql).toContain("ProviderName = 'AWS'");
    });

    it('descarta las filas sin valor de etiqueta', async () => {
        queryMock.mockResolvedValue([[
            { value: 'produccion', cost: '120.50' },
            { value: '', cost: '10' },
        ]]);
        expect(await getAwsCostByTagKey('t1', 'Environment')).toEqual([
            { value: 'produccion', cost: 120.5 },
        ]);
    });
});
