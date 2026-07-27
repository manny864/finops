import { describe, it, expect } from 'vitest';
import { regionIntensity, suggestGreenMigration, calculateEmissions } from '@/services/carbonService';
import { regionCarbonIntensity } from '@/lib/carbonData';

describe('carbonService · regiones AWS', () => {
    it('resuelve la intensidad de las regiones AWS mas usadas', () => {
        expect(regionIntensity('us-east-1')).toBe(380);
        expect(regionIntensity('eu-north-1')).toBe(40);
        expect(regionIntensity('sa-east-1')).toBe(100);
        expect(regionIntensity('ap-south-1')).toBe(720);
    });

    it('los nombres AWS no colisionan con los de Azure', () => {
        // 'eastus' (Azure) y 'us-east-1' (AWS) son claves distintas: si alguien
        // normalizara los nombres, una nube heredaria la intensidad de la otra.
        expect(regionIntensity('eastus')).toBe(380);
        expect(regionIntensity('us-east-1')).toBe(380);
        expect(Object.keys(regionCarbonIntensity).filter((k) => k.includes('-')).length).toBeGreaterThan(20);
    });

    it('cae al default ante una region AWS desconocida en vez de fallar', () => {
        expect(regionIntensity('ap-southeast-9')).toBe(regionCarbonIntensity['default']);
    });

    it('recomienda un destino mas limpio dentro de la misma geografia', () => {
        const rec = suggestGreenMigration('us-east-1');
        expect(rec).not.toBeNull();
        expect(rec!.toRegion).toBe('ca-central-1');
        expect(rec!.targetIntensity).toBeLessThan(rec!.currentIntensity);
        // No propone cruzar el Atlantico: cambiaria la jurisdiccion de los datos.
        expect(rec!.toRegion).not.toMatch(/^eu-/);
    });

    it('no recomienda migrar desde una region que ya es limpia', () => {
        // eu-north-1 no tiene peer y ademas ya esta entre las mas limpias.
        expect(suggestGreenMigration('eu-north-1')).toBeNull();
        expect(suggestGreenMigration('eu-west-3')).toBeNull();
    });

    it('no recomienda destinos que no bajen la intensidad', () => {
        const rec = suggestGreenMigration('ap-northeast-2');
        // Seul (500) hacia Tokio (480): mejora, pero poco. Lo importante es que
        // nunca devuelva un destino igual o peor.
        if (rec) expect(rec.targetIntensity).toBeLessThan(rec.currentIntensity);
    });

    it('no propone peer para India, Africa ni Medio Oriente', () => {
        expect(suggestGreenMigration('ap-south-1')).toBeNull();
        expect(suggestGreenMigration('af-south-1')).toBeNull();
        expect(suggestGreenMigration('me-central-1')).toBeNull();
    });

    it('usa los mismos factores que Azure, asi las dos nubes son comparables', () => {
        // Misma cantidad de horas y misma intensidad de red ⇒ misma huella,
        // independientemente de la nube. Es lo que permite que un Enterprise
        // con las dos sume ambas cifras sin traducir unidades.
        expect(calculateEmissions(730, 'us-east-1')).toBe(calculateEmissions(730, 'eastus'));
    });

    it('escala linealmente con las horas de computo', () => {
        const una = calculateEmissions(730, 'us-east-1');
        const diez = calculateEmissions(7300, 'us-east-1');
        expect(diez).toBeCloseTo(una * 10, 6);
    });
});
