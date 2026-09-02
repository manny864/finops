// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

/**
 * La casilla comercial es `sales@`, no `ventas@`.
 *
 * Había 10 lugares con `ventas@cscloudsolutions.com.ar` —3 archivos de i18n, el
 * fallback del receptor de leads, el mailto de Enterprise en signup y
 * facturación, dos plantillas de mail y el fallback de alertas de cancelación—
 * mientras Terraform declara `AZURE_SENDER_EMAIL`/`AZURE_RECIPIENT_EMAIL` como
 * `sales@`. Con la casilla equivocada se perdían leads y alertas de baja sin
 * que nada fallara visiblemente.
 *
 * Este test recorre el árbol porque el valor está repetido: un solo lugar
 * corregido no alcanza, y el próximo que agregue una plantilla de mail va a
 * copiar de alguna de las existentes.
 */
const ROOT = join(__dirname, "..", "..");
const SCAN_DIRS = ["src", "messages"];
const EXTS = [".ts", ".tsx", ".json"];

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir)) {
        if (entry === "node_modules" || entry.startsWith(".")) continue;
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full, out);
        else if (EXTS.some((e) => entry.endsWith(e))) out.push(full);
    }
    return out;
}

describe("casillas de contacto", () => {
    it("no queda ningún 'ventas@' en src/ ni messages/", () => {
        const offenders: string[] = [];
        for (const d of SCAN_DIRS) {
            for (const f of walk(join(ROOT, d))) {
                if (readFileSync(f, "utf8").includes("ventas@")) {
                    offenders.push(f.replace(ROOT + "/", ""));
                }
            }
        }
        expect(offenders, `usar sales@cscloudsolutions.com.ar en: ${offenders.join(", ")}`).toEqual([]);
    });

    it("el aviso de Enterprise apunta a sales@ en los tres idiomas", () => {
        for (const loc of ["es", "en", "pt-BR"]) {
            const msgs = JSON.parse(readFileSync(join(ROOT, "messages", `${loc}.json`), "utf8"));
            const notice = JSON.stringify(msgs).match(/enterpriseNotice":"[^"]*"/)?.[0] || "";
            expect(notice, `${loc}.json`).toContain("sales@cscloudsolutions.com.ar");
        }
    });
});
