import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import React from "react";

/**
 * Guard del segmento /superadmin.
 *
 * De las 14 páginas bajo /superadmin sólo 2 tenían chequeo propio: el resto se
 * abría escribiendo la URL. Estos casos fijan las tres situaciones del layout,
 * y sobre todo que el gate sea por ROL y no por dominio del email.
 */

const mocks = vi.hoisted(() => ({
    useTenant: vi.fn(),
    replace: vi.fn(),
    toastError: vi.fn(),
}));

vi.mock("@/components/TenantProvider", () => ({ useTenant: mocks.useTenant }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("sonner", () => ({ toast: { error: mocks.toastError } }));
vi.mock("next-intl", () => ({
    useTranslations: () => (key: string) => key,
}));
vi.mock("@tabler/icons-react", () => ({
    IconLoader2: () => <span data-testid="spinner" />,
    IconShieldLock: () => <span data-testid="lock" />,
}));

import SuperAdminLayout from "@/app/[locale]/superadmin/layout";

const CONTENIDO = "panel-de-superadmin";

describe("SuperAdminLayout", () => {
    beforeEach(() => vi.clearAllMocks());

    it("no muestra el contenido ni redirige mientras el rol no resolvió", async () => {
        // systemRole arranca en 'USER': evaluarlo antes de authzResolved echaría
        // al SuperAdmin real antes de que responda el backend.
        mocks.useTenant.mockReturnValue({ systemRole: "USER", authzResolved: false });

        render(<SuperAdminLayout><p>{CONTENIDO}</p></SuperAdminLayout>);

        expect(screen.queryByText(CONTENIDO)).toBeNull();
        expect(screen.getByTestId("spinner")).toBeTruthy();
        expect(mocks.replace).not.toHaveBeenCalled();
    });

    it("bloquea y redirige a un usuario sin el rol", async () => {
        mocks.useTenant.mockReturnValue({ systemRole: "USER", authzResolved: true });

        render(<SuperAdminLayout><p>{CONTENIDO}</p></SuperAdminLayout>);

        // El contenido no se monta: si no, la página dispararía sus fetches.
        expect(screen.queryByText(CONTENIDO)).toBeNull();
        expect(screen.getByTestId("lock")).toBeTruthy();
        await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
        expect(mocks.toastError).toHaveBeenCalled();
    });

    it("deja pasar al SUPERADMIN", async () => {
        mocks.useTenant.mockReturnValue({ systemRole: "SUPERADMIN", authzResolved: true });

        render(<SuperAdminLayout><p>{CONTENIDO}</p></SuperAdminLayout>);

        expect(screen.getByText(CONTENIDO)).toBeTruthy();
        expect(mocks.replace).not.toHaveBeenCalled();
    });

    // Admin/Owner del tenant son roles de TENANT, no del sistema: administran su
    // propia organización, no la plataforma.
    it.each(["Admin", "Owner", "Colaborador", "Reader", ""])(
        "bloquea el rol de sistema %s",
        async (role) => {
            mocks.useTenant.mockReturnValue({ systemRole: role, authzResolved: true });

            render(<SuperAdminLayout><p>{CONTENIDO}</p></SuperAdminLayout>);

            expect(screen.queryByText(CONTENIDO)).toBeNull();
            await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/"));
        }
    );
});
