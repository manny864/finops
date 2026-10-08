import { describe, it, expect } from "vitest";
import { createBm25Index, tokenize } from "@/lib/bm25";

describe("tokenize", () => {
    it("pasa a minúsculas y saca las tildes", () => {
        expect(tokenize("Suscripción NO sincroniza: ¿qué hago?")).toEqual(["suscripcion", "no", "sincroniza", "que", "hago"]);
    });
});

describe("createBm25Index", () => {
    const docs = [
        { id: "alertas", text: "Alertas de presupuesto: cómo configurar umbrales y destinatarios de las alertas." },
        { id: "zombies", text: "Recursos zombies: discos huérfanos e IPs públicas sin uso." },
        { id: "general", text: "La plataforma muestra costos de Azure por suscripción y por grupo de recursos." },
    ];
    const index = createBm25Index(docs, (d) => d.text);

    it("ordena por relevancia y sin importar tildes ni mayúsculas", () => {
        const hits = index.search("no me llegan las ALERTAS del presupuesto", 3);
        expect(hits[0].doc.id).toBe("alertas");
    });

    it("un término raro pesa más que uno que está en todos lados", () => {
        expect(index.search("recursos huérfanos", 3)[0].doc.id).toBe("zombies");
    });

    it("sólo devuelve documentos que comparten algún término, hasta el límite", () => {
        expect(index.search("kubernetes", 3)).toEqual([]);
        expect(index.search("recursos costos alertas", 1)).toHaveLength(1);
    });
});
