import { describe, it, expect } from 'vitest';
import {
    translateAdvisorText,
    translateZombieType,
    extractResourceDisplayName,
    translateColumnHeader,
    formatAdvisorTermAndLookback,
} from '@/lib/advisorI18n';

describe('translateAdvisorText - 5 Pilares', () => {
    // 1. Costo
    it('traduce recomendaciones de costo en los 3 idiomas', () => {
        const text = 'Buy virtual machine reserved instances to save over pay-as-you-go costs';
        expect(translateAdvisorText(text, 'es', 'problem')).toBe('Comprar instancias reservadas de máquinas virtuales para ahorrar sobre el pago por uso');
        expect(translateAdvisorText(text, 'en', 'problem')).toBe('Buy virtual machine reserved instances to save over pay-as-you-go costs');
        expect(translateAdvisorText(text, 'pt-BR', 'problem')).toBe('Comprar instâncias reservadas de máquinas virtuais para economizar sobre o pagamento por uso');
    });

    it('traduce recomendaciones de Savings Plan en los 3 idiomas', () => {
        const text = 'Consider Azure Savings Plan for compute to save over pay-as-you-go costs';
        expect(translateAdvisorText(text, 'es', 'problem')).toContain('Plan de Ahorro (Savings Plan)');
        expect(translateAdvisorText(text, 'pt-BR', 'problem')).toContain('Plano de Economia (Savings Plan)');
    });

    // 2. Seguridad
    it('traduce recomendaciones de seguridad (MFA y Defender)', () => {
        const mfa = 'Enable multi-factor authentication for write permissions on your subscription';
        expect(translateAdvisorText(mfa, 'es', 'problem')).toBe('Habilitar autenticación multifactor (MFA) para cuentas con permisos de escritura');
        expect(translateAdvisorText(mfa, 'pt-BR', 'problem')).toBe('Habilitar autenticação multifator (MFA) para contas com permissões de gravação');

        const defender = 'Enable Microsoft Defender for Cloud on subscriptions';
        expect(translateAdvisorText(defender, 'es', 'problem')).toBe('Habilitar Microsoft Defender for Cloud en las suscripciones');
    });

    // 3. Confiabilidad
    it('traduce recomendaciones de confiabilidad (Zonas de disponibilidad y backups)', () => {
        const az = 'Configure Availability Zones for critical virtual machines';
        expect(translateAdvisorText(az, 'es', 'problem')).toBe('Configurar Zonas de Disponibilidad para máquinas virtuales críticas');
        expect(translateAdvisorText(az, 'pt-BR', 'problem')).toBe('Configurar Zonas de Disponibilidade para máquinas virtuais críticas');
    });

    // 4. Rendimiento
    it('traduce recomendaciones de rendimiento (Premium SSD y Accelerated Networking)', () => {
        const ssd = 'Upgrade to Premium SSD disks to improve performance';
        expect(translateAdvisorText(ssd, 'es', 'problem')).toBe('Actualizar a discos Premium SSD o Ultra Disk para mejorar el rendimiento');

        const net = 'Enable accelerated networking on supported virtual machines';
        expect(translateAdvisorText(net, 'es', 'problem')).toBe('Habilitar aceleración de red en máquinas virtuales compatibles');
    });

    // 5. Excelencia Operativa
    it('traduce recomendaciones de excelencia operativa (Tags y Service Health)', () => {
        const tags = 'Assign tags to resources to improve governance and cost allocation';
        expect(translateAdvisorText(tags, 'es', 'problem')).toBe('Asignar etiquetas a los recursos para mejorar la gobernanza y asignación de costos');

        const health = 'Configure Azure Service Health alerts';
        expect(translateAdvisorText(health, 'es', 'problem')).toBe('Configurar alertas de estado del servicio (Azure Service Health)');
    });

    it('maneja strings vacíos y null sin errores', () => {
        expect(translateAdvisorText(undefined, 'es')).toBe('');
        expect(translateAdvisorText(null, 'es')).toBe('');
        expect(translateAdvisorText('', 'es')).toBe('');
    });
});

describe('extractResourceDisplayName', () => {
    it('extrae el nombre y resourceGroup de un Resource ID de Azure ARM', () => {
        const armId = '/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod-eastus/providers/Microsoft.Compute/virtualMachines/vm-frontend-01';
        const res = extractResourceDisplayName(armId);
        expect(res.name).toBe('vm-frontend-01');
        expect(res.resourceGroup).toBe('rg-prod-eastus');
        expect(res.type).toBe('virtualMachines');
        expect(res.isArmId).toBe(true);
    });

    it('devuelve el nombre simple si no es un ARM ID', () => {
        const plain = 'my-custom-vm-01';
        const res = extractResourceDisplayName(plain);
        expect(res.name).toBe('my-custom-vm-01');
        expect(res.resourceGroup).toBeUndefined();
        expect(res.isArmId).toBe(false);
    });

    it('maneja valores vacíos o nulos', () => {
        expect(extractResourceDisplayName(null).name).toBe('—');
        expect(extractResourceDisplayName('').name).toBe('—');
    });
});

describe('translateColumnHeader', () => {
    it('traduce columnas dinámicas conocidas a español', () => {
        expect(translateColumnHeader('Target Sku', 'es')).toBe('SKU Recomendado');
        expect(translateColumnHeader('Current Sku', 'es')).toBe('SKU Actual');
        expect(translateColumnHeader('Term', 'es')).toBe('Plazo');
        expect(translateColumnHeader('Lookback Period', 'es')).toBe('Período de Análisis');
        expect(translateColumnHeader('Cpu Utilization', 'es')).toBe('Uso de CPU');
    });

    it('traduce columnas dinámicas a portugués', () => {
        expect(translateColumnHeader('Target Sku', 'pt-BR')).toBe('SKU Recomendado');
        expect(translateColumnHeader('Current Sku', 'pt-BR')).toBe('SKU Atual');
        expect(translateColumnHeader('Term', 'pt-BR')).toBe('Prazo');
        expect(translateColumnHeader('Lookback Period', 'pt-BR')).toBe('Período de Análise');
    });

    it('en inglés devuelve los nombres estándar en inglés', () => {
        expect(translateColumnHeader('Target Sku', 'en')).toBe('Recommended SKU');
        expect(translateColumnHeader('Current Sku', 'en')).toBe('Current SKU');
        expect(translateColumnHeader('Term', 'en')).toBe('Term');
    });
});

describe('formatAdvisorTermAndLookback', () => {
    it('formatea P3Y y 30 en español', () => {
        expect(formatAdvisorTermAndLookback('P3Y', '30', 'es')).toBe(' (3 años / 30 días)');
    });

    it('formatea P1Y y 7 en inglés', () => {
        expect(formatAdvisorTermAndLookback('P1Y', '7', 'en')).toBe(' (1 year / 7 days)');
    });

    it('formatea P3Y y 60 en portugués', () => {
        expect(formatAdvisorTermAndLookback('P3Y', '60', 'pt-BR')).toBe(' (3 anos / 60 dias)');
    });
});

describe('translateZombieType', () => {
    it('traduce un tipo conocido', () => {
        expect(translateZombieType('Disk', 'es')).toBe('Disco Desconectado');
        expect(translateZombieType('Disk', 'en')).toBe('Unattached Disk');
    });

    it('tipo desconocido devuelve el nombre original', () => {
        expect(translateZombieType('Nuevo Tipo Raro', 'es')).toBe('Nuevo Tipo Raro');
    });
});
