// @vitest-environment node
/**
 * Cada ruta de `src/app/api/cron/*` tiene un job en producción, o está declarada como "sin job".
 *
 * Una ruta de cron implementa una función (avisar vencimientos, purgar, sincronizar) que corre SOLO si un
 * job de Container Apps la invoca. Si nadie la programa, la función no corre y nada lo avisa: en este repo
 * ya pasó con el cron de reservas (hallazgo de la auditoría de manuales del 2026-10-04) y con el `:00`
 * compartido de 2026-09-16. Medido el 2026-10-10 contra los 29 jobs desplegados: **14 rutas existen y
 * ningún job las invoca** (ninguna estuvo nunca en `infra/`, `.github/` ni `scripts/`).
 *
 * La fuente de verdad de los horarios es `infra/terraform/environments/prod/cron-jobs.tfvars`: la clave de
 * cada job es el nombre de la ruta (`sync` -> `/api/cron/sync`).
 *
 * Este test NO decide si esas 14 deben programarse (decisión de producto). Falla si:
 *  - aparece una ruta de cron nueva sin job y sin estar en `SIN_JOB`;
 *  - un job apunta a una ruta que no existe;
 *  - una ruta de `SIN_JOB` ya tiene job (excepción vieja: sacala de la lista).
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

const RAIZ = process.cwd();
const TFVARS = "infra/terraform/environments/prod/cron-jobs.tfvars";

/** Estado al 2026-10-10. Cada una necesita una decisión: programarla, dispararla a mano a propósito, o borrarla. */
const SIN_JOB: Record<string, string> = {
    "addon-expiry": "el README la documenta como \"Diaria 07:15 UTC\" y no hay job: los avisos de vencimiento de módulos sueltos no salen",
    "cost-exports-sync": "sin job ni referencias",
    "idle-resources-alerts": "sin job ni referencias",
    "invalidate-ai-cache": "sin job ni referencias",
    "partner-link-retry": "el README dice que el panel de Ops la usa para reintentar (disparo manual)",
    "storage-retention-cleanup": "sin job ni referencias: la retención de almacenamiento no corre sola",
    "sync-aml": "sin job ni referencias (`sync-azure-ai` no hace fan-out a las `sync-*`)",
    "sync-azure-search": "sin job ni referencias",
    "sync-content-safety": "sin job ni referencias",
    "sync-databricks": "sin job ni referencias",
    "sync-doc-intel": "sin job ni referencias",
    "sync-foundry": "sin job ni referencias",
    "sync-speech-language": "sin job ni referencias",
    "sync-vision-video": "sin job ni referencias",
};

function clavesDelTfvars(): string[] {
    const texto = readFileSync(path.join(RAIZ, TFVARS), "utf8");
    const bloque = texto.slice(texto.indexOf("cron_jobs = {"));
    return [...bloque.matchAll(/^ {2}([a-z0-9][a-z0-9-]*)\s*=\s*\{/gm)].map((m) => m[1]);
}

function rutasDeCron(): string[] {
    const base = path.join(RAIZ, "src/app/api/cron");
    return readdirSync(base, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(path.join(base, d.name, "route.ts")))
        .map((d) => d.name);
}

describe("rutas de cron vs jobs de producción", () => {
    const claves = clavesDelTfvars();
    const rutas = rutasDeCron();

    it("el test está leyendo algo (decenas de rutas y de jobs)", () => {
        expect(rutas.length).toBeGreaterThan(30);
        expect(claves.length).toBeGreaterThan(20);
    });

    it("todo job apunta a una ruta que existe", () => {
        expect(claves.filter((k) => !rutas.includes(k))).toEqual([]);
    });

    it("toda ruta de cron tiene job o está declarada en SIN_JOB", () => {
        const sinJobNiExcepcion = rutas.filter((r) => !claves.includes(r) && !(r in SIN_JOB));
        expect(
            sinJobNiExcepcion,
            "programala en infra/terraform/environments/prod/cron-jobs.tfvars o, si no debe correr sola, agregala a SIN_JOB con el motivo",
        ).toEqual([]);
    });

    it("SIN_JOB no tiene entradas viejas: ninguna de sus rutas tiene job ni falta en el código", () => {
        expect(Object.keys(SIN_JOB).filter((r) => claves.includes(r) || !rutas.includes(r))).toEqual([]);
    });
});
