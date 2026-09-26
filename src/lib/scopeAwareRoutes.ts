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
    "/api/intelligence/cost-centers": ["GET"],
    "/api/intelligence/cost-centers/resources": ["GET"],
    "/api/intelligence/cost-projection": ["GET"],
    "/api/intelligence/whiteboard": ["GET"],
    "/api/overview/whiteboard": ["GET"],
    "/api/exports/focus": ["GET"],
    "/api/intelligence/forecast": ["POST"],
    "/api/intelligence/forecast/by-service": ["GET"],
    "/api/intelligence/scorecard": ["GET"],
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
    "/api/tenant-logo": ["GET"],
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
 */
export const PAGINAS_CON_ALCANCE: readonly string[] = [
    "/overview/whiteboard",
    "/intelligence/cost-groups",
    "/intelligence/cost-centers",
    "/intelligence/cost-projection",
    "/intelligence/scorecard",
];

/** ¿Esta página se le puede ofrecer a un usuario con alcance asignado? */
export function paginaAdmiteAlcance(href: string): boolean {
    return PAGINAS_CON_ALCANCE.some((p) => href === p || href.startsWith(`${p}/`));
}

function coincide(mapa: Record<string, Metodos>, pathname: string, metodo: string): boolean {
    // Prefijo más largo primero, igual que `ROUTE_TIERS`: `/api/cost-groups/x`
    // tiene que poder decidirse distinto de `/api/cost-groups`.
    const claves = Object.keys(mapa).sort((a, b) => b.length - a.length);
    for (const clave of claves) {
        if (pathname === clave || pathname.startsWith(`${clave}/`)) {
            const metodos = mapa[clave];
            return metodos === "*" || metodos.includes(metodo.toUpperCase());
        }
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
