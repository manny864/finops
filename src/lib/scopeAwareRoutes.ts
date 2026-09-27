/**
 * MEJ-38 — qué le puede responder la API a un usuario con alcance asignado.
 *
 * EL DEFAULT ES NEGAR. Hay 304 rutas con auth de tenant: auditarlas una por una
 * para agregarles el recorte es garantía estadística de olvidar alguna, y este
 * repo ya tiene el precedente escrito — `routeTiers.ts` documenta cómo un
 * bloqueo por tier se volvía **decorativo** porque varias pantallas son alias
 * que sirven el mismo componente desde otra URL y se entraba por la vieja.
 *
 * Así que se invierte la carga: una ruta que no está en ninguna de las dos
 * listas de abajo **no le responde** a un usuario con alcance. Olvidarse de una
 * ruta nueva falla cerrado —un 403 que alguien reporta— y no abierto, que es
 * una fuga que nadie ve.
 *
 * Esto le da a un usuario acotado un producto CHICO, y eso es deliberado: su
 * alcance no es una preferencia que se pueda ignorar cuando incomoda. Crece a
 * medida que los tableros adoptan el recorte (ver MEJ-34).
 *
 * MANTENER EN SYNC CON EL SIDEBAR, igual que `ROUTE_TIERS`: si la API niega una
 * pantalla que el menú sigue ofreciendo, el usuario encuentra un 403 en vez de
 * no encontrar la entrada.
 */

/** Métodos que una entrada habilita. `"*"` es todos. */
type Metodos = readonly string[] | "*";

/**
 * Las rutas que SABEN acotar: llaman a `alcanceDeLaRuta` y, con un alcance de
 * permiso que no pueden aplicar, cortan en vez de servir el tablero entero.
 *
 * ES POR (RUTA, MÉTODO) y no por ruta. Una ruta puede saber acotar su GET y
 * tener un POST que no: 136 de las 304 escriben, y una escritura que recibe
 * identificadores de recurso tiene que validarlos contra el alcance antes de
 * actuar. Habilitar el método equivocado acá es exactamente el agujero que ya
 * apareció con el etiquetado en masa de Centros de Costo.
 */
export const RUTAS_CON_ALCANCE: Record<string, Metodos> = {
    "/api/cost-groups": ["GET"],
    // El detalle de un Cost Group, que sabe recortar (MEJ-34). Se declara con
    // `:name` y no por prefijo: asi `/api/cost-groups/<x>/resource-groups`, que
    // NO sabe recortar, queda afuera.
    "/api/cost-groups/:name": ["GET"],
    "/api/intelligence/cost-centers": ["GET"],
    "/api/intelligence/cost-centers/resources": ["GET"],
    "/api/intelligence/cost-projection": ["GET"],
    "/api/intelligence/whiteboard": ["GET"],
    "/api/overview/whiteboard": ["GET"],
    "/api/exports/focus": ["GET"],
    "/api/intelligence/forecast": ["POST"],
    "/api/intelligence/forecast/by-service": ["GET"],
    "/api/intelligence/scorecard": ["GET"],
    // MEJ-34 — el tablero de almacenamiento, sus dos mitades. Van juntas: con
    // una sola, la pantalla mostraría un total acotado y un desglose por
    // familia que habla de otro universo.
    "/api/intelligence/storage-efficiency": ["GET"],
    "/api/intelligence/storage/service-cost": ["GET"],
};

/**
 * Las rutas que el shell necesita para dibujarse y que no exponen gasto ni
 * inventario: sin ellas la aplicación no carga y el usuario ve una pantalla
 * rota en vez de un producto chico.
 *
 * El criterio para entrar acá es estrecho a propósito — **no exponer nada que
 * un alcance debería recortar**—. `/api/intelligence/perspectives` entra porque
 * devuelve nombres de Perspectives y sus reglas, que es lo que el selector
 * necesita para decir de qué grupo es el usuario; no devuelve un solo importe.
 */
export const RUTAS_DE_SHELL: Record<string, Metodos> = {
    "/api/tenants": ["GET"],
    "/api/subscriptions": ["GET"],
    "/api/tenant-logo/:tenantId": ["GET"],
    // La moneda de visualizacion del propio usuario. Sin ella `CurrencyProvider`
    // cae a la de por defecto y los importes se dibujan en otra moneda.
    // No devuelve un solo dato del tenant: la preferencia y la lista soportada.
    "/api/fx/preference": ["GET"],
    "/api/academy/content": ["GET"],
    "/api/billing/addons/active": ["GET"],
    "/api/billing/plan": ["GET"],
    "/api/billing/subscription": ["GET"],
    "/api/onboarding/progress": ["GET"],
    "/api/intelligence/perspectives": ["GET"],
    // El propio alcance del usuario: si esta ruta no respondiera, el shell no
    // podria saber que hay que acotarse.
    "/api/me/scope": ["GET"],
};

/**
 * Las PÁGINAS que un usuario acotado puede abrir. Es la contraparte de
 * `RUTAS_CON_ALCANCE` del lado del menú, y se mantiene a mano por el mismo
 * motivo que `ROUTE_TIERS`: no hay forma de derivar qué API llama cada pantalla
 * sin un grafo que habría que mantener igual.
 *
 * Si una entra acá sin que su API sepa acotar, el usuario encuentra un 403; si
 * una API sabe acotar y su página no está acá, el usuario no llega a usarla. El
 * segundo error es el barato.
 *
 * CADA PÁGINA DECLARA LAS RUTAS QUE NECESITA. Antes era una lista suelta y el
 * test que cuidaba la consistencia comparaba el último segmento de la URL
 * contra el nombre de la ruta: funcionaba de casualidad, porque las cinco
 * primeras se llamaban igual de los dos lados. Una pantalla cuyo nombre no
 * coincide con el de su API —hay varias— lo rompía sin que hubiera nada mal.
 * Declarado, el invariante se puede comprobar de verdad.
 */
export const PAGINAS_CON_ALCANCE_Y_SUS_RUTAS: Record<string, readonly string[]> = {
    "/overview/whiteboard": ["/api/overview/whiteboard"],
    "/intelligence/cost-groups": ["/api/cost-groups"],
    "/intelligence/cost-centers": ["/api/intelligence/cost-centers"],
    "/intelligence/cost-projection": ["/api/intelligence/cost-projection"],
    "/intelligence/scorecard": ["/api/intelligence/scorecard"],
    // MEJ-34. Auditada con el cruce página → rutas antes de habilitarla: sus 12
    // llamadas caen todas en el mapa, así que no hay un 403 esperándola. Son
    // DOS rutas: con una sola, la pantalla mostraría un total acotado y un
    // desglose por familia que habla de otro universo.
    "/intelligence/almacenamiento/storage-accounts-finops-cmp": [
        "/api/intelligence/storage-efficiency",
        "/api/intelligence/storage/service-cost",
    ],
};

/** Las páginas, para el Sidebar y para `/api/me/scope`. */
export const PAGINAS_CON_ALCANCE: readonly string[] = Object.keys(PAGINAS_CON_ALCANCE_Y_SUS_RUTAS);

/** ¿Esta página se le puede ofrecer a un usuario con alcance asignado? */
export function paginaAdmiteAlcance(href: string): boolean {
    return PAGINAS_CON_ALCANCE.some((p) => href === p || href.startsWith(`${p}/`));
}

/**
 * Coincidencia por SEGMENTOS. Un `:param` vale por exactamente un segmento.
 *
 * ANTES ERA POR PREFIJO, Y ESO ERA UN AGUJERO. `/api/intelligence/perspectives`
 * está en la lista del shell porque devuelve nombres de reglas y —dice el
 * comentario de arriba— «no devuelve un solo importe». Con prefijo habilitaba
 * también a `/api/intelligence/perspectives/breakdown`, que devuelve el gasto
 * de TODOS los grupos del tenant: exactamente lo que el alcance existe para
 * recortar. Lo mismo `/api/cost-groups`, que arrastraba a `.../resource-groups`.
 *
 * Una lista de permitidos que se amplía sola cada vez que alguien agrega una
 * subruta no es una lista de permitidos. Con segmentos, una subruta nueva nace
 * negada —que es la premisa de todo este archivo— y para habilitarla hay que
 * escribirla, que es cuando alguien piensa si sabe recortar.
 */
function coincidePatron(patron: string, pathname: string): boolean {
    const p = patron.split("/");
    const u = pathname.split("/");
    if (p.length !== u.length) return false;
    return p.every((seg, i) => (seg.startsWith(":") ? u[i].length > 0 : seg === u[i]));
}

function coincide(mapa: Record<string, Metodos>, pathname: string, metodo: string): boolean {
    // Lo literal antes que lo parametrizado: `/api/x/resources` le gana a
    // `/api/x/:name` si algún día conviven.
    const claves = Object.keys(mapa).sort(
        (a, b) => (a.split(":").length - 1) - (b.split(":").length - 1)
    );
    for (const clave of claves) {
        if (!coincidePatron(clave, pathname)) continue;
        const metodos = mapa[clave];
        return metodos === "*" || metodos.includes(metodo.toUpperCase());
    }
    return false;
}

/**
 * ¿Esta ruta le puede responder a un usuario con alcance asignado?
 *
 * Devuelve `false` para todo lo que no esté declarado, que es el punto.
 */
export function rutaAdmiteAlcance(pathname: string, metodo: string): boolean {
    return coincide(RUTAS_CON_ALCANCE, pathname, metodo) || coincide(RUTAS_DE_SHELL, pathname, metodo);
}

/** ¿Esta ruta además sabe RECORTAR, o sólo es infraestructura del shell? */
export function rutaRecorta(pathname: string, metodo: string): boolean {
    return coincide(RUTAS_CON_ALCANCE, pathname, metodo);
}
