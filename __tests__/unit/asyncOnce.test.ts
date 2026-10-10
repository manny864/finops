// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import { asyncOnce } from "@/lib/asyncOnce";

describe("asyncOnce", () => {
    it("ejecuta la función una sola vez y todos los llamadores reciben el mismo resultado", async () => {
        const fn = vi.fn(async () => ({ n: 1 }));
        const una = asyncOnce(fn);
        const [a, b, c] = await Promise.all([una(), una(), una()]);
        expect(fn).toHaveBeenCalledTimes(1);
        expect(a).toBe(b);
        expect(b).toBe(c);
        // Y sigue devolviendo lo mismo en llamadas posteriores.
        expect(await una()).toBe(a);
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it("no ejecuta nada hasta que alguien la llama (es perezosa)", () => {
        const fn = vi.fn(async () => 1);
        asyncOnce(fn);
        expect(fn).not.toHaveBeenCalled();
    });

    it("si falla no guarda el error: la llamada siguiente vuelve a intentar", async () => {
        const fn = vi.fn<() => Promise<string>>()
            .mockRejectedValueOnce(new Error("MySQL no responde"))
            .mockResolvedValue("ok");
        const una = asyncOnce(fn);
        await expect(una()).rejects.toThrow("MySQL no responde");
        expect(await una()).toBe("ok");
        expect(await una()).toBe("ok");
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it("los que esperaban un intento que falla reciben todos ese error", async () => {
        let fallar!: (e: Error) => void;
        const una = asyncOnce(() => new Promise<string>((_, rej) => { fallar = rej; }));
        const esperando = [una(), una(), una()].map((p) => p.catch((e) => e.message));
        fallar(new Error("429"));
        expect(await Promise.all(esperando)).toEqual(["429", "429", "429"]);
    });

    it("un throw síncrono de la función se convierte en un rechazo (no rompe al llamador)", async () => {
        const una = asyncOnce((() => { throw new Error("sync"); }) as () => Promise<never>);
        await expect(una()).rejects.toThrow("sync");
    });
});
