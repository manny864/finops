// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const RAIZ = join(__dirname, "..", "..");
const leer = (p: string) => readFileSync(join(RAIZ, p), "utf8");

/**
 * Una alerta sirve cuando se puede CREAR la regla que la dispara.
 *
 * `idle_resources` tenía el tipo en el ENUM de la base y un cron que busca esas
 * reglas, pero la lista de tipos de la UI es fija y no lo incluía: nadie podía
 * crear una, así que el cron iba a correr todos los días y salir con "sin
 * reglas activas" para siempre. El circuito completo son cuatro piezas y las
 * cuatro tienen que estar.
 */
describe("la alerta de recursos ociosos está conectada de punta a punta", () => {
    it("el tipo existe en la base", () => {
        const migraciones = readdirSync(join(RAIZ, "migrations"))
            .filter((f) => f.endsWith(".sql"))
            .map((f) => leer(join("migrations", f)))
            .join("\n");
        expect(migraciones).toMatch(/rule_type ENUM\([^)]*'idle_resources'/);
    });

    it("hay un cron que evalúa esas reglas", () => {
        const cron = leer("src/app/api/cron/idle-resources-alerts/route.ts");
        expect(cron).toContain("rule_type = 'idle_resources'");
    });

    it("la UI deja crear la regla", () => {
        const ui = leer("src/components/dashboard/AlertRulesManager.tsx");
        expect(ui).toMatch(/RULE_TYPES = \[[^\]]*"idle_resources"/);
    });

    it("el umbral se expresa en USD, no en porcentaje", () => {
        // "Avisame cuando haya más de USD 50 al mes tirados". Un % no tendría
        // contra qué medirse: el desperdicio no es fracción de un presupuesto.
        const ui = leer("src/components/dashboard/AlertRulesManager.tsx");
        expect(ui).toMatch(/USD_ONLY_TYPES = new Set\(\["idle_resources"\]\)/);
    });

    it("el cron está agendado en Terraform", () => {
        // Sin esta entrada la ruta existe en producción y no la llama nadie.
        let tfvars: string;
        try {
            tfvars = leer("infra/terraform/environments/prod/terraform.tfvars");
        } catch {
            return; // gitignored: en CI no está, y ahí este assert no aplica
        }
        expect(tfvars).toMatch(/idle-resources-alerts = \{/);
    });
});
