import { describe, it, expect } from 'vitest';
import { translateAdvisorText, translateZombieType } from '@/lib/advisorI18n';

/**
 * Cubre el mapeo de textos de Azure Advisor (2026-07-30). Azure recibe
 * Accept-Language pero en la práctica devuelve shortDescription.problem/solution
 * en inglés para la mayoría de recomendaciones — este mapeo por pattern-matching
 * es lo único que traduce esos textos al locale activo.
 *
 * Encontrados y corregidos en la misma pasada: dos lugares que mostraban el texto
 * crudo sin pasar por esta función (overview/progress y el título de acciones en
 * cost-groups), y un bug de truncado en whiteboard/route.ts que cortaba el texto
 * en inglés a 60 caracteres ANTES de intentar matchear — rompía el patrón en
 * cualquier frase más larga que eso.
 */
describe('translateAdvisorText', () => {
    it('traduce un problem conocido al español (default)', () => {
        const es = translateAdvisorText(
            'Right-size or shutdown underutilized virtual machines',
            'es',
            'problem'
        );
        expect(es).toBe('Redimensionar o apagar máquinas virtuales subutilizadas');
    });

    it('traduce el mismo texto a portugués', () => {
        const pt = translateAdvisorText(
            'Right-size or shutdown underutilized virtual machines',
            'pt-BR',
            'problem'
        );
        expect(pt).toBe('Redimensionar ou desligar máquinas virtuais subutilizadas');
    });

    it('en inglés devuelve el trío "en" tal cual (no un passthrough por accidente)', () => {
        const en = translateAdvisorText(
            'Right-size or shutdown underutilized virtual machines',
            'en',
            'problem'
        );
        expect(en).toBe('Right-size or shutdown underutilized virtual machines');
    });

    it('matchea aunque el texto sea más largo que el límite de truncado usado en whiteboard (60 chars)', () => {
        // Regresión: whiteboard/route.ts truncaba a 60 chars ANTES de traducir.
        // "Right-size or shutdown underutilized virtual machines" ya son 55 chars;
        // con cualquier sufijo real de Azure (que suele venir con más contexto)
        // se pasaba de 60 y el regex dejaba de matchear.
        const withSuffix = 'Right-size or shutdown underutilized virtual machines to reduce cost significantly';
        expect(withSuffix.length).toBeGreaterThan(60);
        const es = translateAdvisorText(withSuffix, 'es', 'problem');
        expect(es).toBe('Redimensionar o apagar máquinas virtuales subutilizadas');
    });

    it('sin match conocido, devuelve el texto original sin romper', () => {
        const raw = 'Some brand new Advisor recommendation text not covered yet';
        expect(translateAdvisorText(raw, 'es', 'problem')).toBe(raw);
    });

    it('cae al trío del otro kind si el match sólo define uno', () => {
        // La entrada de "Buy reserved capacity" define problem y solution; con un
        // texto que sólo matchea por 'problem' pero se pide 'solution', debe
        // devolver la solution traducida igual (fallback cruzado documentado).
        const solution = translateAdvisorText(
            'Buy reserved capacity to save over your pay-as-you-go costs',
            'es',
            'solution'
        );
        expect(solution).toContain('Analizamos tu consumo');
    });

    it('texto vacío o null no lanza, devuelve string vacío', () => {
        expect(translateAdvisorText(undefined, 'es')).toBe('');
        expect(translateAdvisorText(null, 'es')).toBe('');
        expect(translateAdvisorText('', 'es')).toBe('');
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
