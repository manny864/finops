// @vitest-environment node
/**
 * Los manuales, y en particular el del partner.
 *
 * El panel del partner (`/partner`) ofrece el manual en tres idiomas y dos
 * formatos. Un botón que apunta a un archivo que no está le sirve un 404 a
 * quien el panel quiere dejar bien parado, y un manual traducido a medias es
 * peor que uno solo en español porque nadie lo nota hasta que el cliente lo
 * lee. Esto cuida lo que el typecheck no ve.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { MANUALES_DEL_PARTNER, manualParaIdioma } from "@/lib/manualesPartner";

const RAIZ = process.cwd();
const DOCS = path.join(RAIZ, "docs", "manual");
const PUBLICO = path.join(RAIZ, "public", "manual");
const leer = (p: string) => fs.readFileSync(p, "utf-8");

/** Lo que `scripts/generate-manual-pdfs.js` hace con la portada al publicar el .md. */
const sinPortada = (md: string) => md.replace(/<div class="cover">[\s\S]*?<\/div>\s*/, "");

describe("el manual del partner que ofrece el panel", () => {
    for (const m of MANUALES_DEL_PARTNER) {
        describe(m.etiqueta, () => {
            it("el PDF está en public/manual y es un PDF", () => {
                const archivo = path.join(PUBLICO, `${m.archivo}.pdf`);
                expect(fs.existsSync(archivo), `falta ${archivo}: corré node scripts/generate-manual-pdfs.js`).toBe(true);
                const cabecera = fs.readFileSync(archivo).subarray(0, 5).toString("latin1");
                expect(cabecera).toBe("%PDF-");
                expect(fs.statSync(archivo).size).toBeGreaterThan(50_000);
            });

            it("la copia en Markdown es la fuente sin la portada, o sea que no quedó vieja", () => {
                const fuente = path.join(DOCS, `${m.archivo}.md`);
                const copia = path.join(PUBLICO, `${m.archivo}.md`);
                expect(fs.existsSync(fuente), `falta la fuente ${fuente}`).toBe(true);
                expect(fs.existsSync(copia), `falta ${copia}: corré node scripts/generate-manual-pdfs.js`).toBe(true);
                expect(leer(copia), "docs/ cambió y public/manual no se regeneró").toBe(sinPortada(leer(fuente)));
            });

            it("la copia pública no lleva la portada, que usa un logo con ruta relativa al repo", () => {
                expect(leer(path.join(PUBLICO, `${m.archivo}.md`))).not.toContain('<div class="cover">');
            });

            it("el generador de PDFs lo conoce y lo sincroniza a public/manual", () => {
                const generador = leer(path.join(RAIZ, "scripts", "generate-manual-pdfs.js"));
                expect(generador).toContain(`'${m.archivo}.md'`);
                expect(generador).toMatch(new RegExp(`${m.archivo}\\.md'[^}]*public: true[^}]*publicMd: true`));
            });
        });
    }

    it("un idioma sin manual propio cae al español, no a un enlace roto", () => {
        expect(manualParaIdioma("es").archivo).toBe("MANUAL_PARTNER_ES");
        expect(manualParaIdioma("pt-BR").archivo).toBe("MANUAL_PARTNER_PT-BR");
        expect(manualParaIdioma("fr").archivo).toBe("MANUAL_PARTNER_ES");
    });
});

describe("el panel del partner dice lo del manual en los tres idiomas", () => {
    const CLAVES = ["manualTitle", "manualIntro", "manualPdf", "manualMd", "manualOtherLanguages"];
    for (const idioma of ["es", "en", "pt-BR"]) {
        it(`${idioma}: están todas las claves y ninguna está vacía`, () => {
            const mensajes = JSON.parse(leer(path.join(RAIZ, "messages", `${idioma}.json`)));
            for (const c of CLAVES) {
                expect(typeof mensajes.PartnerPanel?.[c], `${idioma}.PartnerPanel.${c}`).toBe("string");
                expect(mensajes.PartnerPanel[c].trim().length).toBeGreaterThan(0);
            }
        });
    }
});

/**
 * LA PARIDAD ENTRE IDIOMAS.
 *
 * Los manuales de usuario y de superadmin llegaron a tener el EN y el PT detrás
 * del ES: faltaba una sección entera de Limpieza de Nube y otra tenía la mitad
 * del texto, sin que nada lo avisara. La estructura —qué secciones hay y en qué
 * orden— es lo único que se puede comparar sin traducir, y es lo que primero se
 * desfasa cuando se agrega una función en un idioma y no en los otros.
 */
describe("los manuales tienen la misma estructura en los tres idiomas", () => {
    const familias = ["MANUAL_USUARIO", "MANUAL_SUPERADMIN", "MANUAL_PARTNER"];
    const idiomas = ["ES", "EN", "PT-BR"];

    /** Los números de sección, en orden: «5.1.3», «7.10», «11.12». Los títulos sin número se cuentan aparte. */
    const estructura = (md: string) => {
        const encabezados = md.split("\n").filter((l) => /^#{2,4} /.test(l));
        const numerados = encabezados
            .map((l) => l.match(/^(#{2,4}) (\d+(?:\.\d+)*(?:-\d+(?:\.\d+)*)?)[.\s]/))
            .filter((x): x is RegExpMatchArray => x !== null)
            .map((x) => `${x[1].length}:${x[2]}`);
        return { numerados, total: encabezados.length };
    };

    for (const familia of familias) {
        it(`${familia}: ES, EN y PT-BR traen las mismas secciones y en el mismo orden`, () => {
            const [es, en, pt] = idiomas.map((i) => estructura(leer(path.join(DOCS, `${familia}_${i}.md`))));
            expect(es.numerados.length).toBeGreaterThan(20);
            expect(en.numerados, `${familia}_EN difiere de ES`).toEqual(es.numerados);
            expect(pt.numerados, `${familia}_PT-BR difiere de ES`).toEqual(es.numerados);
            expect(en.total).toBe(es.total);
            expect(pt.total).toBe(es.total);
        });
    }

    it("cada manual tiene su PDF generado en docs/manual", () => {
        for (const familia of familias) {
            for (const i of idiomas) {
                const pdf = path.join(DOCS, `${familia}_${i}.pdf`);
                expect(fs.existsSync(pdf), `falta ${pdf}`).toBe(true);
            }
        }
    });
});
