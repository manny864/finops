import { describe, it, expect } from "vitest";
import { providersForRoute, isRouteAvailableForProvider } from "@/lib/routeProviders";

/**
 * El filtrado del Sidebar por proveedor es lo que evita que un tenant AWS vea
 * ~30 páginas que fallan al abrirlas. La regla que más importa acá es que el
 * DEFAULT sea azure-only: si alguien agrega una página nueva y se olvida de
 * clasificarla, tiene que quedar oculta para AWS, no rota.
 */
describe("routeProviders", () => {
    it("por defecto una ruta desconocida es azure-only", () => {
        expect(providersForRoute("/intelligence/una-pagina-nueva")).toEqual(["azure"]);
        expect(isRouteAvailableForProvider("/intelligence/una-pagina-nueva", "aws")).toBe(false);
    });

    it("las páginas de plataforma sirven para los dos proveedores", () => {
        for (const route of ["/admin/users", "/admin/billing", "/admin/audit", "/support", "/academy"]) {
            expect(isRouteAvailableForProvider(route, "aws")).toBe(true);
            expect(isRouteAvailableForProvider(route, "azure")).toBe(true);
        }
    });

    it("la raíz siempre está disponible", () => {
        expect(providersForRoute("/")).toEqual(["azure", "aws"]);
    });

    it("las cuentas AWS no se le muestran a un tenant Azure", () => {
        expect(isRouteAvailableForProvider("/admin/cloud-accounts", "aws")).toBe(true);
        expect(isRouteAvailableForProvider("/admin/cloud-accounts", "azure")).toBe(false);
    });

    it("gana el prefijo más largo: lighthouse es Azure aunque cuelgue de /admin", () => {
        expect(isRouteAvailableForProvider("/admin/onboarding/lighthouse", "aws")).toBe(false);
        // Y una subruta de una agnóstica hereda que es agnóstica.
        expect(isRouteAvailableForProvider("/admin/users/permissions", "aws")).toBe(true);
    });

    it("no confunde rutas con prefijo compartido pero distinto segmento", () => {
        // /admin/api-keys es agnóstica; /admin/apim (inventada) no debe heredarlo.
        expect(isRouteAvailableForProvider("/admin/api-keys", "aws")).toBe(true);
        expect(isRouteAvailableForProvider("/admin/apim", "aws")).toBe(false);
    });

    it("las páginas Azure puras siguen ocultas para AWS", () => {
        for (const route of ["/governance/tags", "/intelligence/aks", "/overview/resources"]) {
            expect(isRouteAvailableForProvider(route, "aws")).toBe(false);
            expect(isRouteAvailableForProvider(route, "azure")).toBe(true);
        }
    });

    it("la limpieza de recursos ociosos sirve a ambos proveedores", () => {
        // El inventario AWS lo arma awsInventoryService con las APIs de EC2:
        // es el equivalente de la consulta a Resource Graph en Azure.
        expect(isRouteAvailableForProvider("/cleanup/zombies", "aws")).toBe(true);
        expect(isRouteAvailableForProvider("/cleanup/zombies", "azure")).toBe(true);
    });

    it("las páginas de plataforma no dependen del proveedor del tenant", () => {
        // Administran el producto (identidad, alta, cobro, cumplimiento), no
        // los recursos cloud del cliente.
        for (const route of ["/login", "/signup", "/admin/compliance", "/admin/markup", "/mobile", "/upgrade"]) {
            expect(isRouteAvailableForProvider(route, "aws")).toBe(true);
            expect(isRouteAvailableForProvider(route, "azure")).toBe(true);
        }
    });

    it("las páginas de costo habilitadas en Fase 7 sirven a ambos proveedores", () => {
        // Leen CostSnapshots / CostGroups, que el sync de AWS también alimenta.
        for (const route of [
            "/intelligence/cost-by-category",
            "/intelligence/cost-groups",
            "/intelligence/simulator",
        ]) {
            expect(isRouteAvailableForProvider(route, "aws")).toBe(true);
            expect(isRouteAvailableForProvider(route, "azure")).toBe(true);
        }
    });

    it("habilitar cost-groups no arrastra a sus hermanas de /intelligence", () => {
        // Guarda contra un match por prefijo demasiado laxo: si alguien
        // acortara la entrada a "/intelligence", un tenant AWS vería ~30 páginas
        // que fallan al abrirlas.
        expect(isRouteAvailableForProvider("/intelligence/commitments", "aws")).toBe(false);
        expect(isRouteAvailableForProvider("/intelligence/hybrid-benefit", "aws")).toBe(false);
    });
});

describe('paginas habilitadas en la Fase 7', () => {
    // El WhiteBoard es la landing post-login (src/app/[locale]/page.tsx). Si
    // deja de estar disponible para AWS, el tenant aterriza en una pagina que
    // su propio menu no lista y que ahora ademas bloquea RouteTierGate.
    it('el WhiteBoard esta disponible para AWS por ser la landing post-login', () => {
        expect(isRouteAvailableForProvider('/overview/whiteboard', 'aws')).toBe(true);
        expect(isRouteAvailableForProvider('/overview/whiteboard', 'azure')).toBe(true);
    });

    it('TOP Gastos esta disponible para las dos nubes', () => {
        expect(isRouteAvailableForProvider('/overview/top-expenses', 'aws')).toBe(true);
        expect(isRouteAvailableForProvider('/overview/top-expenses', 'azure')).toBe(true);
    });

    // Dependen de Azure Advisor, que no tiene ingesta equivalente en AWS todavia.
    it('las paginas que dependen de Azure Advisor siguen siendo azure-only', () => {
        expect(isRouteAvailableForProvider('/intelligence/history', 'aws')).toBe(false);
        expect(isRouteAvailableForProvider('/advisor', 'aws')).toBe(false);
    });
});
