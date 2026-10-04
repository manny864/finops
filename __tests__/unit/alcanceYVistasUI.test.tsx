/**
 * MEJ-38 desde la pantalla: asignar alcance y la vista predeterminada.
 * Antes las dos cosas se hacían sólo por API.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("next-intl", () => ({
    useTranslations: () => (k: string, p?: Record<string, unknown>) => (p ? `${k}:${JSON.stringify(p)}` : k),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import UserDataScopeCell from "@/components/admin/users/UserDataScopeCell";
import { predeterminadaQueAplica } from "@/components/SavedViewSelector";

const PERSPECTIVAS = [
    { id: 7, name: "Por equipo", reglas: [{ grupo: "Marketing" }, { grupo: "Data" }, { grupo: null }] },
    { id: 9, name: "Por producto", reglas: [{ grupo: "App" }] },
];

function celda(extra: Partial<React.ComponentProps<typeof UserDataScopeCell>> = {}) {
    const onChanged = vi.fn();
    render(
        <UserDataScopeCell
            email="ana@acme.com"
            rol="READER"
            asignado={null}
            perspectivas={PERSPECTIVAS}
            tenantId="t1"
            authHeaders={async () => ({ Authorization: "Bearer x" })}
            onChanged={onChanged}
            {...extra}
        />,
    );
    return { onChanged };
}

describe("asignar alcance desde la tabla de usuarios", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        global.fetch = vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })) as any;
    });

    it("a un Admin u Owner no se le ofrece: podría saltearlo con una clave de API", () => {
        celda({ rol: "ADMIN" });
        expect(screen.queryByText("dataScopeAssign")).toBeNull();
    });

    it("guarda la Perspective y el grupo elegidos, con la sesión", async () => {
        const { onChanged } = celda();
        fireEvent.click(screen.getByText("dataScopeAssign"));
        fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "Data" } });
        fireEvent.click(screen.getByText("dataScopeSave"));

        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        const [url, init] = (global.fetch as any).mock.calls[0];
        expect(url).toBe("/api/admin/user-scopes");
        expect(init.headers.Authorization).toBe("Bearer x");
        expect(JSON.parse(init.body)).toEqual({ tenantId: "t1", email: "ana@acme.com", perspectiveId: 7, group: "Data" });
    });

    it("los grupos salen de las reglas, sin repetir y sin el vacío", () => {
        celda();
        fireEvent.click(screen.getByText("dataScopeAssign"));
        const opciones = Array.from(screen.getAllByRole("combobox")[1].querySelectorAll("option")).map((o) => o.textContent);
        expect(opciones).toEqual(["dataScopeAllGroups", "Marketing", "Data"]);
    });

    it("«todos los grupos» se manda como null", async () => {
        const { onChanged } = celda();
        fireEvent.click(screen.getByText("dataScopeAssign"));
        fireEvent.click(screen.getByText("dataScopeSave"));
        await waitFor(() => expect(onChanged).toHaveBeenCalled());
        expect(JSON.parse((global.fetch as any).mock.calls[0][1].body).group).toBeNull();
    });
});

describe("qué vista predeterminada se aplica al entrar", () => {
    const v = (id: number, shared: boolean, isDefault = true, perspectiveId: number | null = 7) => ({ id, shared, isDefault, perspectiveId });

    it("la personal gana sobre la del equipo, aunque la API mande primero la compartida", () => {
        expect(predeterminadaQueAplica([v(1, true), v(2, false)])?.id).toBe(2);
    });

    it("sin personal, la del equipo", () => {
        expect(predeterminadaQueAplica([v(1, true), v(2, false, false)])?.id).toBe(1);
    });

    it("una vista sin Perspective no se aplica: no hay qué escribir en la URL", () => {
        expect(predeterminadaQueAplica([v(1, false, true, null)])).toBeNull();
    });
});
