/**
 * Tests de las etiquetas de asignación.
 *
 * Es la pieza que decide cómo se reparte el costo entre equipos y centros de
 * costo, y entra en la clave única de `CostSnapshots`. Un error acá no da un
 * error visible: da plata asignada al equipo equivocado, o filas del agregado
 * diario que se pisan entre sí y hacen desaparecer costo.
 */

import { describe, it, expect } from 'vitest';
import {
    ALLOCATION_TAG_KEYS,
    pickAllocationTags,
    serializeAllocationTags,
    allocationKey,
    allocationTagsForStorage,
    hashAllocationKey,
} from '@/lib/allocationTags';

describe('seleccion de etiquetas de asignacion', () => {
    it('se queda solo con las etiquetas por las que se reparte el costo', () => {
        // `Name` es distinto en cada recurso: si entrara, el agregado diario
        // degeneraria en una copia del detalle.
        const out = pickAllocationTags({ CostCenter: 'CC-100', Name: 'web-01', foo: 'bar' });
        expect(out).toEqual({ CostCenter: 'CC-100' });
    });

    it('unifica las variantes de mayusculas y separadores', () => {
        // Las etiquetas pueden ser case-sensitive: estas tres conviven en la
        // misma cuenta como etiquetas distintas y parten el costo en tres.
        expect(pickAllocationTags({ costcenter: 'CC-1' })).toEqual({ CostCenter: 'CC-1' });
        expect(pickAllocationTags({ 'cost-center': 'CC-1' })).toEqual({ CostCenter: 'CC-1' });
        expect(pickAllocationTags({ Cost_Center: 'CC-1' })).toEqual({ CostCenter: 'CC-1' });
    });

    it('resuelve los alias frecuentes al mismo concepto', () => {
        expect(pickAllocationTags({ BusinessUnit: 'Retail' })).toEqual({ CostCenter: 'Retail' });
        expect(pickAllocationTags({ env: 'prod' })).toEqual({ Environment: 'prod' });
        expect(pickAllocationTags({ squad: 'plataforma' })).toEqual({ Team: 'plataforma' });
    });

    it('no normaliza el VALOR de la etiqueta', () => {
        // `prod` y `Prod` pueden ser dos entornos distintos; no nos toca
        // decidirlo, y unificarlos escondería un problema de higiene real.
        expect(pickAllocationTags({ Environment: 'Prod' })).toEqual({ Environment: 'Prod' });
    });

    it('la coincidencia exacta le gana a la variante', () => {
        const out = pickAllocationTags({ costcenter: 'malo', CostCenter: 'bueno' });
        expect(out).toEqual({ CostCenter: 'bueno' });
        // Y da igual el orden en que la nube las devuelva.
        const invertido = pickAllocationTags({ CostCenter: 'bueno', costcenter: 'malo' });
        expect(invertido).toEqual({ CostCenter: 'bueno' });
    });

    it('descarta valores vacios en vez de crear un cubo fantasma', () => {
        expect(pickAllocationTags({ CostCenter: '', Team: '   ', Environment: 'dev' }))
            .toEqual({ Environment: 'dev' });
    });

    it('tolera entradas que no son un objeto de etiquetas', () => {
        for (const entrada of [null, undefined, 'CostCenter=1', 42, ['CostCenter']]) {
            expect(pickAllocationTags(entrada)).toEqual({});
        }
    });

    it('convierte a texto los valores que no lo son', () => {
        expect(pickAllocationTags({ CostCenter: 100 })).toEqual({ CostCenter: '100' });
    });
});

describe('serializacion estable', () => {
    it('produce la misma clave sin importar el orden de las etiquetas', () => {
        const a = serializeAllocationTags({ CostCenter: 'CC-1', Team: 'core', Environment: 'prod' });
        const b = serializeAllocationTags({ Environment: 'prod', CostCenter: 'CC-1', Team: 'core' });
        expect(a).toBe(b);
    });

    it('distingue dos combinaciones distintas', () => {
        const a = serializeAllocationTags({ CostCenter: 'CC-1' });
        const b = serializeAllocationTags({ CostCenter: 'CC-2' });
        expect(a).not.toBe(b);
    });

    it('no confunde un valor con separador con dos etiquetas', () => {
        // El separador es un caracter de control, justamente para que un valor
        // con "=" o "|" no pueda falsificar otra combinacion.
        const a = serializeAllocationTags({ CostCenter: 'CC-1|Team=core' });
        const b = serializeAllocationTags({ CostCenter: 'CC-1', Team: 'core' });
        expect(a).not.toBe(b);
    });

    it('el costo sin etiquetar produce la clave vacia', () => {
        expect(serializeAllocationTags({})).toBe('');
        expect(serializeAllocationTags({ Name: 'web-01' })).toBe('');
        expect(serializeAllocationTags(null)).toBe('');
    });
});

describe('huella persistida', () => {
    it('el costo sin asignar conserva la clave vacia, no el hash del vacio', () => {
        // De esto depende que la migracion no genere duplicados: todo lo ya
        // persistido tiene '' y debe seguir colisionando consigo mismo.
        expect(hashAllocationKey('')).toBe('');
    });

    it('acota la longitud, que es la razon de hashear', () => {
        // Un valor de etiqueta largo no puede hacer que la clave unica supere
        // el limite de 3072 bytes de InnoDB.
        const largo = serializeAllocationTags({ Project: 'x'.repeat(2000) });
        expect(hashAllocationKey(largo)).toHaveLength(64);
    });

    it('es determinista y distingue claves distintas', () => {
        const k1 = allocationKey({ CostCenter: 'CC-1' });
        const k2 = allocationKey({ CostCenter: 'CC-2' });
        expect(hashAllocationKey(k1)).toBe(hashAllocationKey(k1));
        expect(hashAllocationKey(k1)).not.toBe(hashAllocationKey(k2));
    });

    it('dos recursos con las mismas etiquetas comparten fila del agregado', () => {
        const uno = hashAllocationKey(allocationKey({ CostCenter: 'CC-1', Name: 'web-01' }));
        const otro = hashAllocationKey(allocationKey({ CostCenter: 'CC-1', Name: 'web-02' }));
        expect(uno).toBe(otro);
    });
});

describe('lo que se guarda en la columna Tags', () => {
    it('guarda solo el subconjunto que define la fila', () => {
        // Guardar el resto seria guardar las etiquetas de UNO de los recursos
        // que se sumaron, dando a entender que valen para todos.
        expect(allocationTagsForStorage({ CostCenter: 'CC-1', Name: 'web-01' }))
            .toEqual({ CostCenter: 'CC-1' });
    });

    it('devuelve null cuando no hay ninguna, para no guardar {} vacio', () => {
        expect(allocationTagsForStorage({ Name: 'web-01' })).toBeNull();
        expect(allocationTagsForStorage(null)).toBeNull();
    });

    it('lo guardado es consultable con la sintaxis que usan las vistas', () => {
        // Las vistas hacen JSON_EXTRACT(Tags, '$.CostCenter').
        const guardado = allocationTagsForStorage({ businessunit: 'Retail' });
        expect(guardado).not.toBeNull();
        expect(JSON.parse(JSON.stringify(guardado))).toHaveProperty('CostCenter', 'Retail');
    });
});

describe('contrato del orden canonico', () => {
    it('CostCenter va primero: es la etiqueta que consultan casi todas las vistas', () => {
        expect(ALLOCATION_TAG_KEYS[0]).toBe('CostCenter');
    });

    it('no hay claves repetidas', () => {
        expect(new Set(ALLOCATION_TAG_KEYS).size).toBe(ALLOCATION_TAG_KEYS.length);
    });

    it('el orden de la serializacion sigue al orden canonico, no al de entrada', () => {
        const s = serializeAllocationTags({ Team: 'core', CostCenter: 'CC-1' });
        expect(s.indexOf('CostCenter')).toBeLessThan(s.indexOf('Team'));
    });
});
