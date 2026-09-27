/**
 * MEJ-39 — catálogo de fin de soporte (EOL/EOS) de la plataforma Azure.
 *
 * Catálogo CURADO en el repo, no la API de Service Health. La decisión y su
 * costo: un catálogo es auditable —se ve en el diff qué fecha cambió y quién
 * la cambió— y envejece. Por eso lleva `CATALOGO_REVISADO_EL` y la pantalla lo
 * muestra: un catálogo de fechas sin fecha propia es una trampa, porque calla
 * igual cuando está al día que cuando quedó viejo.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * CONTRATOS VERIFICADOS (2026-09-27). No agregar una familia sin hacer esto.
 *
 * Un tipo equivocado, una tabla equivocada o un campo que no existe devuelven
 * VACÍO, no un error: la pantalla diría "este cliente no tiene nada" y nadie se
 * enteraría. Cada familia de abajo se verificó así:
 *
 * - AKS `properties.kubernetesVersion` — referencia ARM de
 *   Microsoft.ContainerService/managedClusters. Textual: "The version of
 *   Kubernetes specified by the user", y admite `<major.minor>` sin patch.
 *   Por eso la granularidad es `major.minor`: el soporte de AKS es por versión
 *   menor, así que el patch no cambia la respuesta.
 * - PostgreSQL Flexible `properties.version` — referencia ARM de
 *   Microsoft.DBforPostgreSQL/flexibleServers: "Major version of PostgreSQL
 *   database engine", enum desde '11'. Devuelve SOLO la mayor ("14").
 * - MySQL Flexible `properties.version` — verificado contra el tenant real con
 *   `az graph query`: devuelve la versión COMPLETA ("8.0.21"), no la mayor.
 *
 * Las dos bases usan el mismo nombre de campo y NO la misma granularidad. Esa
 * diferencia es la razón de que `normalizar()` exista en vez de comparar la
 * cadena cruda.
 *
 * Las tres viven en la tabla `Resources` de Resource Graph.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * LO QUE SE DEJÓ AFUERA, A PROPÓSITO
 *
 * `microsoft.sql/servers` NO está. Su `properties.version` devuelve "12.0" —
 * verificado contra el tenant real— y vale "12.0" para todos: es la versión
 * del SERVIDOR LÓGICO, que no se retira nunca. Cruzarla contra un calendario
 * de fin de soporte daría una respuesta con forma de dato y sin significado.
 * El EOL de SQL vive en el nivel de compatibilidad de cada base y en SQL Server
 * sobre VM, que es otro contrato y hay que verificarlo aparte.
 */

/** Cuándo se revisaron estas fechas contra learn.microsoft.com. Se muestra en pantalla. */
export const CATALOGO_REVISADO_EL = "2026-09-27";

/** Días que definen el semáforo. */
export const DIAS_CRITICO = 90;
export const DIAS_PROXIMO = 365;

export type Ventana = "retirado" | "critico" | "proximo" | "soportado" | "sin-datos";

export interface EscalonDeVersion {
    /** Clave ya normalizada: "1.32", "14", "8.0". */
    version: string;
    /** Fin del soporte estándar, ISO. */
    finDeSoporte: string;
    /**
     * Fin del soporte EXTENDIDO, si el producto lo ofrece.
     *
     * No es un detalle: es la mitad de por qué esto es costo y no sólo riesgo.
     * Quedarse tiene dos finales y los dos se pagan — migración de urgencia sin
     * presupuestar, o soporte extendido, que tiene precio de lista.
     */
    finExtendido?: string;
    nota?: string;
}

export interface FamiliaDeCicloDeVida {
    armType: string;
    etiqueta: string;
    /** Ruta dentro de `properties` de donde sale la versión. */
    campoDeVersion: string;
    granularidad: "major" | "major.minor";
    /** De dónde salieron las fechas. Va en el payload para que sea auditable. */
    fuente: string;
    /**
     * ¿Una versión por debajo de la más vieja del catálogo está retirada?
     *
     * Es `true` cuando la fuente sólo publica lo vigente y lo por venir (AKS),
     * o cuando la tabla ya incluye las vencidas (las dos bases). Se declara por
     * familia en vez de asumirse: en un producto que publicara sólo las últimas
     * tres versiones sin decir nada de las viejas, asumirlo sería inventar.
     */
    menoresRetiradas: boolean;
    escalones: EscalonDeVersion[];
}

export const CATALOGO_DE_CICLO_DE_VIDA: FamiliaDeCicloDeVida[] = [
    {
        armType: "microsoft.containerservice/managedclusters",
        etiqueta: "Azure Kubernetes Service",
        campoDeVersion: "kubernetesVersion",
        granularidad: "major.minor",
        fuente: "https://learn.microsoft.com/azure/aks/supported-kubernetes-versions",
        menoresRetiradas: true,
        escalones: [
            // AKS sostiene 12 meses una versión GA. La fuente escribe el fin
            // como mes ("Mar 2026") y aclara que significa el ÚLTIMO día del
            // mes, no el primero: acá van ya resueltos al último día.
            { version: "1.32", finDeSoporte: "2026-03-31" },
            { version: "1.33", finDeSoporte: "2026-07-31" },
            { version: "1.34", finDeSoporte: "2026-11-30" },
            { version: "1.35", finDeSoporte: "2027-03-31" },
            { version: "1.36", finDeSoporte: "2027-06-30" },
            { version: "1.37", finDeSoporte: "2027-10-31" },
        ],
    },
    {
        armType: "microsoft.dbforpostgresql/flexibleservers",
        etiqueta: "PostgreSQL Flexible Server",
        campoDeVersion: "version",
        granularidad: "major",
        fuente: "https://learn.microsoft.com/azure/postgresql/configure-maintain/concepts-version-policy",
        menoresRetiradas: true,
        escalones: [
            { version: "11", finDeSoporte: "2026-07-31" },
            { version: "12", finDeSoporte: "2026-07-31" },
            { version: "13", finDeSoporte: "2026-07-31" },
            { version: "14", finDeSoporte: "2026-12-11" },
            { version: "15", finDeSoporte: "2027-11-11" },
            { version: "16", finDeSoporte: "2028-11-09" },
            { version: "17", finDeSoporte: "2029-11-08" },
            { version: "18", finDeSoporte: "2030-11-14" },
        ],
    },
    {
        armType: "microsoft.dbformysql/flexibleservers",
        etiqueta: "MySQL Flexible Server",
        campoDeVersion: "version",
        granularidad: "major.minor",
        fuente: "https://learn.microsoft.com/azure/mysql/concepts-version-policy",
        menoresRetiradas: true,
        escalones: [
            {
                version: "5.7",
                finDeSoporte: "2026-09-30",
                finExtendido: "2029-03-31",
                nota: "La comunidad la retiró el 31-oct-2023. El soporte extendido de Azure se cobra aparte.",
            },
            {
                version: "8.0",
                finDeSoporte: "2027-01-31",
                finExtendido: "2029-05-31",
                nota: "La comunidad la retira el 30-abr-2026, antes que Azure.",
            },
            { version: "8.4", finDeSoporte: "2032-04-30" },
        ],
    },
];

/** Recorta la versión cruda a la granularidad con la que el catálogo la indexa. */
export function normalizar(cruda: unknown, granularidad: "major" | "major.minor"): string | null {
    const s = String(cruda ?? "").trim().replace(/^v/i, "");
    if (!s) return null;
    const partes = s.split(".").filter((p) => /^\d+$/.test(p));
    if (partes.length === 0) return null;
    return granularidad === "major" ? partes[0] : partes.slice(0, 2).join(".");
}

/** Compara "1.9" < "1.10" numéricamente, que es lo que `<` sobre cadenas no hace. */
function comparar(a: string, b: string): number {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const d = (pa[i] ?? 0) - (pb[i] ?? 0);
        if (d !== 0) return d;
    }
    return 0;
}

export interface EstadoDeCicloDeVida {
    ventana: Ventana;
    version: string | null;
    finDeSoporte: string | null;
    finExtendido: string | null;
    diasRestantes: number | null;
    nota: string | null;
    /** Por qué quedó en "sin-datos", cuando corresponde. */
    motivo: string | null;
}

const SIN_DATOS = (motivo: string, version: string | null = null): EstadoDeCicloDeVida => ({
    ventana: "sin-datos",
    version,
    finDeSoporte: null,
    finExtendido: null,
    diasRestantes: null,
    nota: null,
    motivo,
});

/**
 * El estado de un recurso contra el catálogo.
 *
 * LA REGLA QUE MANDA: sin dato NO es "soportado".
 *
 * Es el error que este tablero existe para no cometer, y ya está cometido en el
 * repo: `getOpenShiftLifecycleStatus` (`src/lib/aroUtils.ts`) abre con
 * `if (!version || version === "unknown") return "active_support"`, o sea que
 * un cluster cuya versión no se pudo leer se pinta igual que uno al día. Una
 * pantalla de riesgo que ante la duda tranquiliza es peor que no tenerla.
 */
export function evaluarCicloDeVida(
    familia: FamiliaDeCicloDeVida,
    versionCruda: unknown,
    hoy: Date = new Date(),
): EstadoDeCicloDeVida {
    const version = normalizar(versionCruda, familia.granularidad);
    if (!version) return SIN_DATOS("No se pudo leer la versión del recurso.");

    const exacto = familia.escalones.find((e) => e.version === version);
    if (!exacto) {
        const masVieja = familia.escalones.reduce((a, b) => (comparar(a.version, b.version) <= 0 ? a : b));
        if (familia.menoresRetiradas && comparar(version, masVieja.version) < 0) {
            // Por debajo de lo que la fuente publica. Para estas familias la
            // fuente ya incluye lo vencido, así que estar por debajo es estar
            // retirado hace rato — no es una laguna del catálogo.
            return {
                ventana: "retirado",
                version,
                finDeSoporte: null,
                finExtendido: null,
                diasRestantes: null,
                nota: `Por debajo de la versión más antigua que publica ${familia.etiqueta} (${masVieja.version}).`,
                motivo: null,
            };
        }
        // Por ENCIMA del catálogo: el que está viejo es el catálogo, no el
        // recurso. Decir "soportado" sería adivinar con cara de dato.
        return SIN_DATOS(
            `La versión ${version} es posterior a la última revisión del catálogo (${CATALOGO_REVISADO_EL}).`,
            version,
        );
    }

    const fin = new Date(`${exacto.finDeSoporte}T23:59:59Z`);
    const dias = Math.ceil((fin.getTime() - hoy.getTime()) / 86_400_000);
    const ventana: Ventana =
        dias < 0 ? "retirado" : dias <= DIAS_CRITICO ? "critico" : dias <= DIAS_PROXIMO ? "proximo" : "soportado";

    return {
        ventana,
        version,
        finDeSoporte: exacto.finDeSoporte,
        finExtendido: exacto.finExtendido ?? null,
        diasRestantes: dias,
        nota: exacto.nota ?? null,
        motivo: null,
    };
}

/** Los tipos ARM que hay que pedirle a Resource Graph. */
export const TIPOS_DEL_CATALOGO = CATALOGO_DE_CICLO_DE_VIDA.map((f) => f.armType);

export function familiaDeTipo(armType: string): FamiliaDeCicloDeVida | undefined {
    const t = String(armType || "").toLowerCase();
    return CATALOGO_DE_CICLO_DE_VIDA.find((f) => f.armType === t);
}
