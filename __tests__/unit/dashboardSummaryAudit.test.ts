import { describe, it, expect } from 'vitest';
import { mapAuditData } from '@/app/api/dashboard/summary/route';

describe('mapAuditData — MEJ-10: Catálogo unificado y marcado de origen', () => {
  it('marca savingsSource: cost_management cuando el audit trae estimatedMonthlyCost medido', () => {
    const mockAudit = {
      unattachedDisks: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/disks/disk-1',
          name: 'disk-1',
          estimatedMonthlyCost: 45.2,
        },
      ],
    };

    const { mappedData, zombieCount } = mapAuditData(mockAudit);
    expect(zombieCount).toBe(1);
    expect(mappedData).toHaveLength(1);
    expect(mappedData[0].potentialSavings).toBe(45.2);
    expect(mappedData[0].savingsSource).toBe('cost_management');
    expect(mappedData[0].issueType).toBe('cost');
  });

  it('marca savingsSource: type_baseline y calcula la línea base cuando no hay estimatedMonthlyCost', () => {
    const mockAudit = {
      unusedIps: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/publicIPAddresses/pip-1',
          name: 'pip-1',
        },
      ],
      emptyAse: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Web/hostingEnvironments/ase-1',
          name: 'ase-1',
        },
      ],
      stoppedVirtualMachines: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-stopped-1',
          name: 'vm-stopped-1',
        },
      ],
    };

    const { mappedData, zombieCount } = mapAuditData(mockAudit);
    expect(zombieCount).toBe(3);

    const pip = mappedData.find((d) => d.name === 'pip-1');
    expect(pip).toBeDefined();
    expect(pip?.potentialSavings).toBe(3.5);
    expect(pip?.savingsSource).toBe('type_baseline');

    const ase = mappedData.find((d) => d.name === 'ase-1');
    expect(ase).toBeDefined();
    expect(ase?.potentialSavings).toBe(300);
    expect(ase?.savingsSource).toBe('type_baseline');

    const vm = mappedData.find((d) => d.name === 'vm-stopped-1');
    expect(vm).toBeDefined();
    expect(vm?.potentialSavings).toBeCloseTo(23.36, 2);
    expect(vm?.savingsSource).toBe('type_baseline');
  });

  it('calcula la línea base proporcional en discos según diskSizeGB/sizeGB', () => {
    const mockAudit = {
      unattachedDisks: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/disks/disk-large',
          name: 'disk-large',
          diskSizeGB: 256,
        },
      ],
      staleSnapshots: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/snapshots/snap-1',
          name: 'snap-1',
          sizeGB: 100,
        },
      ],
    };

    const { mappedData } = mapAuditData(mockAudit);
    const disk = mappedData.find((d) => d.name === 'disk-large');
    expect(disk?.potentialSavings).toBeCloseTo(256 * 0.154, 2);
    expect(disk?.savingsSource).toBe('type_baseline');

    const snap = mappedData.find((d) => d.name === 'snap-1');
    expect(snap?.potentialSavings).toBeCloseTo(100 * 0.05, 2);
    expect(snap?.savingsSource).toBe('type_baseline');
  });

  it('clasifica hallazgos de gobernanza con potentialSavings 0 y issueType governance', () => {
    const mockAudit = {
      orphanedNics: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Network/networkInterfaces/nic-1',
          name: 'nic-1',
        },
      ],
      emptyRgs: [
        {
          id: '/subscriptions/sub-1/resourceGroups/rg-empty',
          name: 'rg-empty',
        },
      ],
    };

    const { mappedData } = mapAuditData(mockAudit);
    expect(mappedData).toHaveLength(2);
    expect(mappedData[0].issueType).toBe('governance');
    expect(mappedData[0].potentialSavings).toBe(0);
    expect(mappedData[0].savingsSource).toBe('none');
  });

  it('omite tipos marcados como __skip__ y excluye NON_ZOMBIE_AUDIT_KEYS del zombieCount', () => {
    const mockAudit = {
      allVirtualMachines: [
        { id: 'vm-1', name: 'vm-1' },
        { id: 'vm-2', name: 'vm-2' },
      ],
      taggingNonCompliance: [
        { id: 'res-1', name: 'res-1' },
      ],
      unattachedDisks: [
        { id: 'disk-1', name: 'disk-1' },
      ],
    };

    const { mappedData, zombieCount } = mapAuditData(mockAudit);
    // allVirtualMachines es skip (no entra en mappedData) y non-zombie
    // taggingNonCompliance entra en mappedData como Tag Issue pero es non-zombie
    // unattachedDisks entra en mappedData y cuenta en zombieCount
    expect(zombieCount).toBe(1);
    expect(mappedData.some((d) => d.name === 'vm-1')).toBe(false);
    expect(mappedData.some((d) => d.name === 'res-1')).toBe(true);
    expect(mappedData.some((d) => d.name === 'disk-1')).toBe(true);
  });
});
