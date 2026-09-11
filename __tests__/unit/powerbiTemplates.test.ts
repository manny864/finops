// @vitest-environment node
import { describe, it, expect } from "vitest";
import { POWERBI_TEMPLATES, getTemplate } from "@/lib/powerbiTemplates";

/**
 * Los cuatro scripts eran copias a mano que ya habian derivado entre si (uno
 * leia Source[data] sin proteger, otros no). Ahora salen de un constructor,
 * asi que lo que hay que fijar son las propiedades que hacen que el script
 * FUNCIONE en Power BI, no el texto.
 */
describe("templates de Power BI", () => {
    it.each(POWERBI_TEMPLATES.map((t) => [t.id, t] as const))(
        "%s usa RelativePath y no concatena la URL",
        (_id, tpl) => {
            /*
             * Este es EL defecto de los scripts que se entregaban: con
             * Web.Contents(BaseUrl & "/api/...") Power BI no puede analizar el
             * origen estaticamente y la actualizacion programada del Servicio
             * falla — funciona en Desktop y recien se rompe al publicar.
             */
            expect(tpl.powerQueryM).toContain('RelativePath = "api/exports/powerbi-feed"');
            expect(tpl.powerQueryM).not.toContain('BaseUrl & "/api');
        }
    );

    it.each(POWERBI_TEMPLATES.map((t) => [t.id, t] as const))(
        "%s tolera una respuesta vacia y campos faltantes",
        (_id, tpl) => {
            // Sin el try, un feed sin datos rompe la consulta entera.
            expect(tpl.powerQueryM).toMatch(/try Response\[\w+\] otherwise \{\}/);
            // Sin la rama de lista vacia, el expand sobre una tabla vacia falla.
            expect(tpl.powerQueryM).toContain("if List.IsEmpty(Payload) then");
            // Expand con campos explicitos: un campo que la API deje de mandar
            // sale null en vez de tumbar el rename.
            expect(tpl.powerQueryM).toContain("Table.ExpandRecordColumn");
            expect(tpl.powerQueryM).not.toContain("Table.FromRecords");
        }
    );

    it("los comentarios viajan como marcadores, no como castellano fijo", () => {
        for (const tpl of POWERBI_TEMPLATES) {
            expect(tpl.powerQueryM).toMatch(/\{\{cmt\.pq_\w+\}\}/);
            expect(tpl.powerQueryM).not.toContain("Para usar este script");
        }
    });

    it("deja los placeholders para que el cliente inyecte las credenciales", () => {
        for (const tpl of POWERBI_TEMPLATES) {
            expect(tpl.powerQueryM).toContain("<YOUR_BASE_URL>");
            expect(tpl.powerQueryM).toContain("<YOUR_MCP_KEY>");
        }
    });

    it("getTemplate resuelve por id y no inventa", () => {
        expect(getTemplate("zombies")?.feedType).toBe("zombies");
        expect(getTemplate("no-existe")).toBeUndefined();
    });
});
