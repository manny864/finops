import { expect } from "vitest";
import { createTranslator } from "next-intl";
import es from "@/../messages/es.json";
import en from "@/../messages/en.json";
import ptBR from "@/../messages/pt-BR.json";

const CATALOGOS = { es, en, "pt-BR": ptBR } as Record<string, Record<string, unknown>>;

interface AccionConClaves {
    titleKey: string;
    descKey: string;
    impactKey?: string;
    stepKeys?: string[];
    params?: Record<string, string | number>;
}

/**
 * Corre las claves que el servicio emitió DE VERDAD contra los tres catálogos.
 *
 * El guard de `i18nClavesDinamicas` lee el código fuente; esto lee el objeto que
 * el servicio construyó en runtime. La diferencia importa: el escáner ve
 * `params: { account, savings }` en el literal, pero no ve si esos valores
 * llegan poblados ni si el ternario de `descKey` eligió una clave que existe.
 *
 * Se llama desde los tests de servicio que ya tienen fixtures armados, en vez de
 * duplicar cien líneas de fixtures acá.
 */
export function esperarQueRindanLasClaves(acciones: AccionConClaves[], namespace: string): void {
    expect(acciones.length, "el fixture no produjo ninguna acción").toBeGreaterThan(0);

    for (const accion of acciones) {
        const claves = [accion.titleKey, accion.descKey, accion.impactKey, ...(accion.stepKeys ?? [])]
            .filter((c): c is string => typeof c === "string");

        for (const locale of Object.keys(CATALOGOS)) {
            const t = createTranslator({ locale, messages: CATALOGOS[locale], namespace });
            for (const clave of claves) {
                const texto = t(clave, accion.params ?? {});
                const donde = `${locale} · ${namespace}.${clave}`;
                // next-intl devuelve la clave misma cuando no la encuentra.
                expect(texto, donde).not.toBe(clave);
                // Un marcador suelto = el servicio no mandó el param que el texto pide.
                expect(texto, donde).not.toMatch(/[{}]/);
                expect(texto, donde).not.toContain("undefined");
            }
        }
    }
}
