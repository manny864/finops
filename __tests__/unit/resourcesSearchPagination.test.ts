// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Cubre el selector de tamaño de página (15/30/45/60) de Recursos → Buscar
 * (2026-07-30). Antes el mock de resources_search devolvía siempre 15 filas
 * fijas sin importar pageSize: activar el selector en modo demo mostraba
 * "60 filas" en el paginador pero seguía renderizando sólo 15. Ahora el mock
 * expone `allRows` (el set completo) y la ruta lo sliceá según el page/pageSize
 * real.
 */

vi.mock('@/lib/requestAuth', () => ({
    requireTenantTier: vi.fn(async () => ({ email: 'x@demo.com', tenantId: 'mock-tenant' })),
    AuthError: class extends Error {},
}));

const MOCK_TENANT = 'demo_tenant';

function request(qs: string): NextRequest {
    return new NextRequest(`http://localhost/api/resources/search?tenantId=${MOCK_TENANT}${qs}`);
}

describe('GET /api/resources/search — paginado en modo mock', () => {
    it('con pageSize=60 devuelve hasta 60 filas, no las 15 fijas de antes', async () => {
        const { GET } = await import('@/app/api/resources/search/route');
        const res = await GET(request('&page=1&pageSize=60'));
        const json = await res.json();

        expect(json.pageSize).toBe(60);
        expect(json.rows.length).toBe(60);
    });

    it('la página 2 con pageSize=30 trae las filas 31-60, no las mismas de la página 1', async () => {
        const { GET } = await import('@/app/api/resources/search/route');
        const p1 = await (await GET(request('&page=1&pageSize=30'))).json();
        const p2 = await (await GET(request('&page=2&pageSize=30'))).json();

        expect(p1.rows.length).toBe(30);
        expect(p2.rows.length).toBe(30);
        const p1Ids = new Set(p1.rows.map((r: any) => r.id));
        const overlap = p2.rows.filter((r: any) => p1Ids.has(r.id));
        expect(overlap.length).toBe(0);
    });

    it('nunca expone allRows (el set completo) en la respuesta', async () => {
        const { GET } = await import('@/app/api/resources/search/route');
        const json = await (await GET(request('&page=1&pageSize=15'))).json();
        expect(json.allRows).toBeUndefined();
    });

    it('pageSize por encima del techo (60) se recorta, no se ignora', async () => {
        const { GET } = await import('@/app/api/resources/search/route');
        const json = await (await GET(request('&page=1&pageSize=999'))).json();
        expect(json.pageSize).toBe(60);
    });
});
