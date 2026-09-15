/**
 * Uso real de Azure Virtual Desktop: usuarios, horas de conexion y pico de
 * concurrencia por Host Pool, desde la tabla `WVDConnections` de Log Analytics.
 *
 * POR QUE NO ALCANZA CON RESOURCE GRAPH
 * El inventario dice cuantos session hosts hay y cuanto cuestan; no dice si
 * alguien los usa. Un pool de 10 hosts con 3 usuarios reales cuesta lo mismo
 * que uno con 300, y sin este dato la unica referencia para dimensionar es el
 * `maxSessionLimit` configurado --que es una intencion, no una medicion--.
 * Tambien es lo unico que permite calcular el costo POR USUARIO, que es como
 * un cliente de AVD piensa el gasto.
 *
 * DE DONDE SALE EL WORKSPACE
 * No se pide configurar nada: se lee el diagnostic setting del propio host pool
 * y de ahi el workspace al que manda sus logs. Si el tenant no tiene el
 * diagnostico prendido, no hay dato --y se dice cual es el motivo, que no es lo
 * mismo que cero--.
 *
 * NADA DE ESTO DEPENDE DE VALORES DE ENUM. La duracion se calcula como
 * `max(TimeGenerated) - min(TimeGenerated)` por `CorrelationId`, no filtrando
 * por `State == "Connected"`. Es levemente conservador (el ultimo evento puede
 * preceder a la desconexion real) pero no se rompe si Azure agrega o renombra
 * un estado. La leccion la dejo el mismo dia el tipo
 * `hostpools/sessionhosts`, que se pedia a una tabla donde no existe y
 * devolvia cero filas en vez de un error ([[avdService]]).
 */

/** Por que no hay dato de uso. Se expone: un vacio sin motivo no se puede accionar. */
export type MotivoSinUso =
    | "sin_diagnostico"
    | "sin_permiso"
    | "sin_datos"
    | "error";

export interface AvdUsoHostPool {
    disponible: boolean;
    motivo?: MotivoSinUso;
    usuariosUnicos: number;
    conexiones: number;
    horasConexion: number;
    /** Maximo de usuarios distintos conectados en una misma hora del periodo. */
    picoConcurrencia: number;
    diasAnalizados: number;
}

const DIAS_ANALIZADOS = 30;

function vacio(motivo: MotivoSinUso): AvdUsoHostPool {
    return {
        disponible: false,
        motivo,
        usuariosUnicos: 0,
        conexiones: 0,
        horasConexion: 0,
        picoConcurrencia: 0,
        diasAnalizados: DIAS_ANALIZADOS,
    };
}

async function token(credential: any, audiencia: string): Promise<string | null> {
    try {
        const t = await credential.getToken(audiencia);
        return t?.token || null;
    } catch {
        return null;
    }
}

/**
 * Workspace al que el host pool manda sus logs, leido de su diagnostic setting.
 * Devuelve el resourceId ARM del workspace, o null si no hay diagnostico.
 */
export async function getWorkspaceDeHostPool(credential: any, hostPoolId: string): Promise<string | null> {
    const bearer = await token(credential, "https://management.azure.com/.default");
    if (!bearer) return null;
    try {
        const url = `https://management.azure.com${hostPoolId}/providers/microsoft.insights/diagnosticSettings?api-version=2021-05-01-preview`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store" });
        if (!res.ok) return null;
        const payload: any = await res.json();
        for (const ajuste of payload?.value || []) {
            const ws = ajuste?.properties?.workspaceId;
            if (typeof ws === "string" && ws.length > 0) return ws;
        }
        return null;
    } catch {
        return null;
    }
}

/**
 * El GUID que `api.loganalytics.io` espera, que NO es el resourceId ARM del
 * workspace sino su `properties.customerId`.
 */
export async function getCustomerIdDeWorkspace(credential: any, workspaceArmId: string): Promise<string | null> {
    const bearer = await token(credential, "https://management.azure.com/.default");
    if (!bearer) return null;
    try {
        const url = `https://management.azure.com${workspaceArmId}?api-version=2022-10-01`;
        const res = await fetch(url, { headers: { Authorization: `Bearer ${bearer}` }, cache: "no-store" });
        if (!res.ok) return null;
        const payload: any = await res.json();
        const customerId = payload?.properties?.customerId;
        return typeof customerId === "string" && customerId.length > 0 ? customerId : null;
    } catch {
        return null;
    }
}

/**
 * Convierte la respuesta de Log Analytics (columnas + filas) en objetos.
 * Exportada para poder testear el parseo sin pegarle a Azure.
 */
export function filasDeRespuestaLA(payload: any): Array<Record<string, unknown>> {
    const tabla = payload?.tables?.[0];
    if (!tabla) return [];
    const columnas: string[] = (tabla.columns || []).map((c: any) => String(c?.name || ""));
    return (tabla.rows || []).map((fila: any[]) => {
        const obj: Record<string, unknown> = {};
        columnas.forEach((nombre, i) => {
            obj[nombre] = fila[i];
        });
        return obj;
    });
}

/**
 * Arma el resumen de uso a partir de las filas ya parseadas.
 *
 * Separado de la llamada HTTP a proposito: es la unica parte con logica y es
 * la que se puede testear sin un tenant con AVD.
 */
export function resumirUso(filas: Array<Record<string, unknown>>): AvdUsoHostPool {
    if (filas.length === 0) return vacio("sin_datos");
    const f = filas[0];
    const num = (clave: string): number => {
        const v = Number(f[clave]);
        return Number.isFinite(v) ? v : 0;
    };
    return {
        disponible: true,
        usuariosUnicos: num("usuariosUnicos"),
        conexiones: num("conexiones"),
        horasConexion: Number(num("horasConexion").toFixed(1)),
        picoConcurrencia: num("picoConcurrencia"),
        diasAnalizados: DIAS_ANALIZADOS,
    };
}

/**
 * KQL del resumen por host pool.
 *
 * `_ResourceId` se compara en minuscula contra el id del host pool. La duracion
 * sale del span entre el primer y el ultimo evento de cada `CorrelationId`, y
 * el pico es el maximo de usuarios distintos en una ventana de una hora.
 */
export function kqlUsoHostPool(hostPoolId: string, dias: number = DIAS_ANALIZADOS): string {
    const id = hostPoolId.toLowerCase().replace(/'/g, "");
    return `
        let ventana = ${dias}d;
        let conexiones = WVDConnections
            | where TimeGenerated > ago(ventana)
            | where tolower(_ResourceId) == '${id}';
        let spans = conexiones
            | summarize inicio = min(TimeGenerated), fin = max(TimeGenerated) by CorrelationId
            | extend horas = datetime_diff('second', fin, inicio) / 3600.0;
        let pico = conexiones
            | summarize usuarios = dcount(UserName) by bin(TimeGenerated, 1h)
            | summarize picoConcurrencia = max(usuarios);
        conexiones
        | summarize usuariosUnicos = dcount(UserName), conexiones = dcount(CorrelationId)
        | extend horasConexion = toscalar(spans | summarize sum(horas))
        | extend picoConcurrencia = toscalar(pico | project picoConcurrencia)
    `.trim();
}

async function consultarLogAnalytics(
    credential: any,
    customerId: string,
    kql: string,
): Promise<{ filas: Array<Record<string, unknown>>; motivo?: MotivoSinUso }> {
    const bearer = await token(credential, "https://api.loganalytics.io/.default");
    if (!bearer) return { filas: [], motivo: "sin_permiso" };
    try {
        const res = await fetch(`https://api.loganalytics.io/v1/workspaces/${customerId}/query`, {
            method: "POST",
            headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
            body: JSON.stringify({ query: kql }),
            cache: "no-store",
        });
        if (res.status === 401 || res.status === 403) return { filas: [], motivo: "sin_permiso" };
        if (!res.ok) return { filas: [], motivo: "error" };
        return { filas: filasDeRespuestaLA(await res.json()) };
    } catch {
        return { filas: [], motivo: "error" };
    }
}

/**
 * Uso por host pool. Un workspace se consulta una sola vez por host pool, y el
 * `customerId` se cachea por workspace dentro de la corrida: varios pools del
 * mismo tenant suelen compartir workspace.
 */
export async function getUsoPorHostPool(
    credential: any,
    hostPoolIds: string[],
): Promise<Map<string, AvdUsoHostPool>> {
    const salida = new Map<string, AvdUsoHostPool>();
    const customerIdPorWorkspace = new Map<string, string | null>();

    await Promise.all(
        hostPoolIds.map(async (hostPoolId) => {
            const workspaceArmId = await getWorkspaceDeHostPool(credential, hostPoolId);
            if (!workspaceArmId) {
                salida.set(hostPoolId.toLowerCase(), vacio("sin_diagnostico"));
                return;
            }
            const clave = workspaceArmId.toLowerCase();
            if (!customerIdPorWorkspace.has(clave)) {
                customerIdPorWorkspace.set(clave, await getCustomerIdDeWorkspace(credential, workspaceArmId));
            }
            const customerId = customerIdPorWorkspace.get(clave);
            if (!customerId) {
                salida.set(hostPoolId.toLowerCase(), vacio("sin_permiso"));
                return;
            }
            const { filas, motivo } = await consultarLogAnalytics(credential, customerId, kqlUsoHostPool(hostPoolId));
            salida.set(hostPoolId.toLowerCase(), motivo ? vacio(motivo) : resumirUso(filas));
        }),
    );

    return salida;
}
