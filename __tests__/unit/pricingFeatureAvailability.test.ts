import { describe, it, expect } from 'vitest';
import en from '../../messages/en.json';
import es from '../../messages/es.json';
import ptBR from '../../messages/pt-BR.json';
import { AWS_AVAILABLE_FEATURES, isFeatureAvailable } from '@/lib/pricingFeatureAvailability';

const LOCALES: Record<string, any> = { en, es, 'pt-BR': ptBR };
const TIERS = ['essential', 'pro', 'business', 'enterprise'];

describe('disponibilidad de features por nube en la tabla de precios', () => {
    it('los indices declarados existen en las tres traducciones', () => {
        // La lista es posicional: si alguien reordena las features de un plan,
        // la tabla de AWS empieza a tachar la fila equivocada en silencio.
        for (const [lang, dict] of Object.entries(LOCALES)) {
            for (const tier of TIERS) {
                const features = dict.pricing[tier].features as string[];
                for (const idx of AWS_AVAILABLE_FEATURES[tier]) {
                    expect(features[idx], `${lang}: ${tier}.features[${idx}] no existe`).toBeDefined();
                }
            }
        }
    });

    it('ninguna feature ofrecida en AWS nombra un producto exclusivo de Azure', () => {
        const AZURE_ONLY = ['AKS', 'AHB', 'Azure Advisor', 'Asesor de Azure', 'Lighthouse',
            'Entra', 'MACC', 'Hybrid', 'M365', 'Azure Marketplace'];
        const offenders: string[] = [];
        for (const [lang, dict] of Object.entries(LOCALES)) {
            for (const tier of TIERS) {
                const features = dict.pricing[tier].features as string[];
                for (const idx of AWS_AVAILABLE_FEATURES[tier]) {
                    const hit = AZURE_ONLY.find((term) =>
                        new RegExp(`\\b${term}`, 'i').test(features[idx]));
                    if (hit) offenders.push(`${lang}: ${tier}[${idx}] "${features[idx]}" menciona ${hit}`);
                }
            }
        }
        expect(offenders, offenders.join('\n')).toEqual([]);
    });

    it('cada plan declara su limite de scope en cuentas de AWS', () => {
        for (const [lang, dict] of Object.entries(LOCALES)) {
            for (const tier of TIERS) {
                const scope = dict.pricing[tier].awsScope as string;
                expect(scope, `${lang}: ${tier} no tiene awsScope`).toBeTruthy();
                expect(/AWS/i.test(scope), `${lang}: ${tier}.awsScope no nombra AWS`).toBe(true);
                // El limite en AWS se cuenta en cuentas, no en suscripciones.
                expect(/suscripci|subscription|assinatura/i.test(scope),
                    `${lang}: ${tier}.awsScope habla de suscripciones`).toBe(false);
            }
        }
    });

    it('el scope siempre esta disponible y Azure nunca tacha features', () => {
        for (const tier of TIERS) {
            expect(isFeatureAvailable(tier, 0, 'aws'), `${tier}: el scope debe verse en AWS`).toBe(true);
            expect(isFeatureAvailable(tier, 99, 'azure')).toBe(true);
        }
    });

    it('un plan desconocido no ofrece nada en AWS', () => {
        // Fail-closed: si aparece un tier nuevo sin clasificar, sus features se
        // muestran como no disponibles en vez de prometerse por defecto.
        expect(isFeatureAvailable('nuevo-tier', 0, 'aws')).toBe(false);
    });
});
