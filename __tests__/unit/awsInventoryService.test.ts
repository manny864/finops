/**
 * Tests del inventario AWS.
 *
 * Se ejercitan las funciones puras de clasificacion y costeo, que son las que
 * deciden si un recurso es desperdicio y cuanto se ahorra al borrarlo. Las
 * llamadas a EC2 quedan fuera a proposito: lo que puede romperse en silencio
 * aca es un criterio mal escrito (marcar como huerfano un volumen en uso), no
 * el transporte HTTP del SDK.
 */

import { describe, it, expect } from 'vitest';
import type { Volume, Address, Snapshot, Instance } from '@aws-sdk/client-ec2';
import {
    ebsMonthlyCost,
    idleEipMonthlyCost,
    snapshotMonthlyCost,
    volumesToZombies,
    addressesToZombies,
    snapshotsToZombies,
    stoppedInstancesToZombies,
} from '@/modules/collectors/aws/awsInventoryService';

const REGION = 'us-east-1';
const ACCOUNT = '123456789012';

describe('costeo de recursos AWS ociosos', () => {
    it('cobra el volumen EBS segun su tipo, no un precio unico', () => {
        // Un gp3 y un io1 del mismo tamaño no cuestan lo mismo: si el motor
        // usara un precio plano, el ahorro reportado seria falso.
        expect(ebsMonthlyCost('gp3', 100).toString()).toBe('8');
        expect(ebsMonthlyCost('io1', 100).toString()).toBe('12.5');
        expect(ebsMonthlyCost('sc1', 100).toString()).toBe('1.5');
    });

    it('cae a gp2 ante un tipo de volumen desconocido', () => {
        expect(ebsMonthlyCost('gp9-inexistente', 10).toString()).toBe('1');
        expect(ebsMonthlyCost(undefined, 10).toString()).toBe('1');
    });

    it('no arrastra el error de coma flotante en el costo del volumen', () => {
        // 0.10 * 3 en float da 0.30000000000000004. Regla Cero: con Decimal no.
        expect(ebsMonthlyCost('gp2', 3).toString()).toBe('0.3');
    });

    it('cobra la IP elastica ociosa por hora reservada', () => {
        expect(idleEipMonthlyCost().toString()).toBe('3.65');
    });

    it('cobra el snapshot por GB', () => {
        expect(snapshotMonthlyCost(200).toString()).toBe('10');
        expect(snapshotMonthlyCost(undefined).toString()).toBe('0');
    });
});

describe('deteccion de volumenes EBS huerfanos', () => {
    const volumes: Volume[] = [
        { VolumeId: 'vol-libre', State: 'available', VolumeType: 'gp3', Size: 500, Tags: [{ Key: 'Name', Value: 'backup-viejo' }] },
        { VolumeId: 'vol-en-uso', State: 'in-use', VolumeType: 'gp3', Size: 500 },
    ];

    it('marca solo los volumenes en estado available', () => {
        const out = volumesToZombies(volumes, REGION, ACCOUNT);
        expect(out).toHaveLength(1);
        expect(out[0].resourceId).toBe('vol-libre');
    });

    it('nunca marca un volumen adjunto a una instancia', () => {
        const out = volumesToZombies(volumes, REGION, ACCOUNT);
        expect(out.map((v) => v.resourceId)).not.toContain('vol-en-uso');
    });

    it('usa el tag Name como nombre y cae al id si no hay tag', () => {
        const out = volumesToZombies(volumes, REGION, ACCOUNT);
        expect(out[0].name).toBe('backup-viejo');
        const sinTag = volumesToZombies([{ VolumeId: 'vol-x', State: 'available', VolumeType: 'gp2', Size: 1 }], REGION, ACCOUNT);
        expect(sinTag[0].name).toBe('vol-x');
    });

    it('reporta el ahorro mensual del volumen huerfano', () => {
        const out = volumesToZombies(volumes, REGION, ACCOUNT);
        expect(out[0].monthlyCost).toBe(40); // 500 GB gp3 * 0.08
    });
});

describe('deteccion de IPs elasticas ociosas', () => {
    const addresses: Address[] = [
        { AllocationId: 'eipalloc-ocioso', PublicIp: '52.0.0.1' },
        { AllocationId: 'eipalloc-usado', PublicIp: '52.0.0.2', AssociationId: 'eipassoc-1' },
        { AllocationId: 'eipalloc-ec2classic', PublicIp: '52.0.0.3', InstanceId: 'i-123' },
    ];

    it('marca solo la IP sin asociacion ni instancia', () => {
        const out = addressesToZombies(addresses, REGION, ACCOUNT);
        expect(out).toHaveLength(1);
        expect(out[0].resourceId).toBe('eipalloc-ocioso');
    });

    it('no marca una IP asociada a una instancia por el campo legacy InstanceId', () => {
        const out = addressesToZombies(addresses, REGION, ACCOUNT);
        expect(out.map((a) => a.resourceId)).not.toContain('eipalloc-ec2classic');
    });
});

describe('deteccion de snapshots vencidos', () => {
    const now = new Date('2026-07-01T00:00:00Z');
    const dias = (n: number) => new Date(now.getTime() - n * 24 * 60 * 60 * 1000);

    it('marca los snapshots mas viejos que el umbral de 90 dias', () => {
        const snaps: Snapshot[] = [
            { SnapshotId: 'snap-viejo', StartTime: dias(120), VolumeSize: 100 },
            { SnapshotId: 'snap-nuevo', StartTime: dias(10), VolumeSize: 100 },
        ];
        const out = snapshotsToZombies(snaps, REGION, ACCOUNT, now);
        expect(out.map((s) => s.resourceId)).toEqual(['snap-viejo']);
    });

    it('no marca un snapshot justo en el limite del umbral', () => {
        const out = snapshotsToZombies([{ SnapshotId: 'snap-borde', StartTime: dias(89), VolumeSize: 10 }], REGION, ACCOUNT, now);
        expect(out).toHaveLength(0);
    });
});

describe('deteccion de instancias detenidas', () => {
    const volumesById = new Map<string, Volume>([
        ['vol-os', { VolumeId: 'vol-os', VolumeType: 'gp3', Size: 100 }],
        ['vol-datos', { VolumeId: 'vol-datos', VolumeType: 'io1', Size: 200 }],
    ]);
    const instances: Instance[] = [
        {
            InstanceId: 'i-detenida',
            State: { Name: 'stopped' },
            BlockDeviceMappings: [
                { Ebs: { VolumeId: 'vol-os' } },
                { Ebs: { VolumeId: 'vol-datos' } },
            ],
        },
        { InstanceId: 'i-viva', State: { Name: 'running' }, BlockDeviceMappings: [{ Ebs: { VolumeId: 'vol-os' } }] },
    ];

    it('marca solo las instancias detenidas', () => {
        const out = stoppedInstancesToZombies(instances, volumesById, REGION, ACCOUNT);
        expect(out.map((i) => i.resourceId)).toEqual(['i-detenida']);
    });

    it('cobra la suma de sus volumenes EBS, que se siguen facturando', () => {
        // Una instancia stopped no factura computo, pero si el disco: el
        // desperdicio real son 100GB gp3 (8) + 200GB io1 (25) = 33.
        const out = stoppedInstancesToZombies(instances, volumesById, REGION, ACCOUNT);
        expect(out[0].monthlyCost).toBe(33);
    });

    it('no explota si el volumen adjunto no esta en el inventario', () => {
        const huerfana: Instance[] = [{
            InstanceId: 'i-rara',
            State: { Name: 'stopped' },
            BlockDeviceMappings: [{ Ebs: { VolumeId: 'vol-inexistente' } }],
        }];
        const out = stoppedInstancesToZombies(huerfana, volumesById, REGION, ACCOUNT);
        expect(out[0].monthlyCost).toBe(0);
    });
});

describe('contrato del item de inventario', () => {
    it('expone region y cuenta para poder agrupar como en Azure', () => {
        const out = volumesToZombies([{ VolumeId: 'vol-1', State: 'available', VolumeType: 'gp3', Size: 10 }], 'sa-east-1', ACCOUNT);
        expect(out[0].region).toBe('sa-east-1');
        expect(out[0].accountId).toBe(ACCOUNT);
        expect(out[0].resourceType).toBe('aws.ec2/volumes');
        expect(out[0].reason).toBe('unattachedVolumes');
    });

    it('normaliza los tags a un objeto plano', () => {
        const out = volumesToZombies(
            [{ VolumeId: 'vol-1', State: 'available', VolumeType: 'gp3', Size: 10, Tags: [{ Key: 'env', Value: 'prod' }, { Key: 'owner', Value: '' }] }],
            REGION, ACCOUNT
        );
        expect(out[0].tags).toEqual({ env: 'prod', owner: '' });
    });
});
