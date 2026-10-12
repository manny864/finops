import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import React from "react";

/**
 * Paso 2 (Service Principal) y paso 3 (primera sincronización) del asistente de onboarding.
 *
 * El síntoma que se reportó: "se ingresan client ID, tenant ID y secreto y no validan". La causa: el formulario llamaba a
 * `/api/admin/diagnose-sp`, que no existía; el 404 hacía lanzar a `response.json()`, el `catch` sólo escribía en la
 * consola y la pantalla no decía nada. El paso 3 tenía la misma enfermedad con `/api/admin/sync/trigger`: el 404 no
 * lanzaba y el paso quedaba "completado" sin sincronizar nada.
 */

const SELECCIONADO = {
  id: "81ebe027-e6af-4e09-bc73-58c9012c6408",
  name: "CSCS Infra",
  has_client_secret: false,
};
const OTRO_DIRECTORIO = "8b41364f-581a-4e43-b7cb-13138dac5517";
const CLIENT_ID = "ebc0781f-bf47-45b8-b0a4-e7f19f69b4fa";
const SECRETO = "Xy8~Q-valor-del-secreto_ABC123.def456";

const mocks = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  setSelectedTenant: vi.fn(),
  msal: { instance: {}, accounts: [{ username: "ana@cscloudsolutions.com.ar" }] },
  tenant: { selectedTenant: null as unknown },
}));

vi.mock("next-intl", async () => {
  const { readFileSync } = await import("node:fs");
  const es = JSON.parse(readFileSync("messages/es.json", "utf-8"));
  const cache: Record<string, (key: string, values?: Record<string, unknown>) => string> = {};
  return {
    useLocale: () => "es",
    useTranslations: (ns: string) =>
      (cache[ns] ??= (key, values) => {
        const raw: string = es[ns]?.[key] ?? key;
        return values ? raw.replace(/\{(\w+)\}/g, (m, k) => (k in values ? String(values[k]) : m)) : raw;
      }),
  };
});
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useParams: () => ({ locale: "es" }) }));
vi.mock("@azure/msal-react", () => ({ useMsal: () => mocks.msal }));
vi.mock("@/lib/msalToken", () => ({ fetchWithAuthRetry: mocks.fetchMock }));
vi.mock("@/components/TenantProvider", () => ({
  useTenant: () => ({ selectedTenant: mocks.tenant.selectedTenant, setSelectedTenant: mocks.setSelectedTenant }),
}));
vi.mock("@/components/SubscriptionProvider", () => ({ useSubscription: () => ({ subscriptions: [] }) }));

import OnboardingPage from "@/app/[locale]/onboarding/page";

const T = JSON.parse(readFileSync("messages/es.json", "utf-8")).OnboardingWizard as Record<string, string>;
const json = (cuerpo: unknown, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "Content-Type": "application/json" } });
const PROGRESO = { step_welcome: "completed", step_azure_sp: "pending", step_first_sync: "pending", step_first_budget: "pending", step_notifications: "pending", percent_complete: 20 };

/** Responde por ruta; cada test pisa sólo lo que le interesa. */
function servidor(rutas: Record<string, (init?: RequestInit) => Response | Promise<Response>>) {
  mocks.fetchMock.mockImplementation(async (_i: unknown, _a: unknown, url: string, init?: RequestInit) => {
    const f = rutas[url];
    if (!f) throw new Error(`ruta sin simular: ${url}`);
    return f(init);
  });
}
const llamadas = (url: string) => mocks.fetchMock.mock.calls.filter(([, , u]) => u === url);

const base = {
  "/api/onboarding/progress": (init?: RequestInit) => {
    if (init?.method === "PUT") {
      const { step, status } = JSON.parse(String(init.body));
      return json({ ...PROGRESO, [step]: status });
    }
    return json(PROGRESO);
  },
};

async function abrirPaso2YCompletar(valores: { client?: string; secreto?: string; tenant?: string } = {}) {
  render(<OnboardingPage />);
  // El botón "Empezar" del paso 2 revela el formulario (ver WizardStep).
  const empezar = await screen.findAllByRole("button", { name: T.start });
  fireEvent.click(empezar[0]);
  const [campoClient, campoTenant] = screen.getAllByPlaceholderText(/XXXXXXXX-XXXX/);
  fireEvent.change(campoClient, { target: { value: valores.client ?? CLIENT_ID } });
  fireEvent.change(campoTenant, { target: { value: valores.tenant ?? SELECCIONADO.id } });
  fireEvent.change(screen.getByPlaceholderText("••••••••••••••••"), { target: { value: valores.secreto ?? SECRETO } });
}
const validar = () => fireEvent.click(screen.getByRole("button", { name: T.validate }));

beforeEach(() => {
  mocks.fetchMock.mockReset();
  mocks.setSelectedTenant.mockReset();
  mocks.tenant.selectedTenant = { ...SELECCIONADO };
  vi.stubGlobal("alert", vi.fn());
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("paso 2: validar el Service Principal", () => {
  it("una ruta que contesta con HTML (404/502) no deja la pantalla muda: dice que no se pudo completar la consulta", async () => {
    servidor({ ...base, "/api/admin/diagnose-sp": () => new Response("<html>404</html>", { status: 404 }) });
    await abrirPaso2YCompletar();
    validar();
    expect(await screen.findByText(T.spErrNetwork)).toBeTruthy();
    expect(llamadas("/api/tenants")).toHaveLength(0);
  });

  it.each([
    ["SECRET_ID_NOT_VALUE", "spErrSecretIdNotValue"],
    ["INVALID_SECRET", "spErrInvalidSecret"],
    ["SECRET_EXPIRED", "spErrSecretExpired"],
    ["APP_NOT_FOUND", "spErrAppNotFound"],
    ["TENANT_NOT_FOUND", "spErrTenantNotFound"],
    ["APP_DISABLED", "spErrAppDisabled"],
    ["ACCESS_DENIED", "spErrAccessDenied"],
    ["NO_SUBSCRIPTIONS", "spErrNoSubscriptions"],
    ["NETWORK", "spErrNetwork"],
    ["RATE_LIMITED", "spErrRateLimited"],
    ["INVALID_INPUT", "spErrInvalidInput"],
  ])("el código %s muestra su mensaje y no guarda nada", async (code, clave) => {
    servidor({ ...base, "/api/admin/diagnose-sp": () => json({ success: false, code, error: "texto de respaldo del servidor" }) });
    await abrirPaso2YCompletar();
    validar();
    expect(await screen.findByText(T[clave])).toBeTruthy();
    expect(screen.queryByText("texto de respaldo del servidor")).toBeNull();
    expect(llamadas("/api/tenants")).toHaveLength(0);
    expect(mocks.setSelectedTenant).not.toHaveBeenCalled();
  });

  it("AUTH_FAILED incluye el número AADSTS para poder pasárselo a soporte", async () => {
    servidor({ ...base, "/api/admin/diagnose-sp": () => json({ success: false, code: "AUTH_FAILED", aadsts: "50012" }) });
    await abrirPaso2YCompletar();
    validar();
    expect(await screen.findByText(T.spErrAuthFailed.replace("{aadsts}", "50012"))).toBeTruthy();
  });

  it("un 403 del servidor (sin código) muestra el texto que mandó", async () => {
    servidor({ ...base, "/api/admin/diagnose-sp": () => json({ success: false, error: "Acceso denegado: requiere rol Admin/Owner." }, 403) });
    await abrirPaso2YCompletar();
    validar();
    expect(await screen.findByText("Acceso denegado: requiere rol Admin/Owner.")).toBeTruthy();
  });

  it("un Tenant ID que no es el de este entorno se avisa SIN mandar el secreto a ningún lado", async () => {
    servidor({ ...base });
    await abrirPaso2YCompletar({ tenant: OTRO_DIRECTORIO });
    validar();
    expect(await screen.findByText(T.spErrTenantMismatch.replace("{tenant}", SELECCIONADO.id))).toBeTruthy();
    expect(llamadas("/api/admin/diagnose-sp")).toHaveLength(0);
    expect(llamadas("/api/tenants")).toHaveLength(0);
  });

  it("válido: valida con el tenant en el que se actúa, guarda las credenciales en ESE tenant y marca el paso", async () => {
    servidor({
      ...base,
      "/api/admin/diagnose-sp": () => json({ success: true, subscriptions: 2, names: ["Producción", "Dev"] }),
      "/api/tenants": () => json({ success: true }),
    });
    await abrirPaso2YCompletar();
    validar();
    await waitFor(() => expect(mocks.setSelectedTenant).toHaveBeenCalled());

    const [, , , diag] = llamadas("/api/admin/diagnose-sp")[0];
    expect(JSON.parse(String(diag.body))).toEqual({
      client_id: CLIENT_ID,
      client_secret: SECRETO,
      tenant_id: SELECCIONADO.id,
      platform_tenant_id: SELECCIONADO.id,
    });
    const [, , , guardado] = llamadas("/api/tenants")[0];
    expect(guardado.method).toBe("PUT");
    expect(JSON.parse(String(guardado.body))).toEqual({ tenantId: SELECCIONADO.id, name: "CSCS Infra", clientId: CLIENT_ID, clientSecret: SECRETO });
    expect(mocks.setSelectedTenant).toHaveBeenCalledWith(expect.objectContaining({ id: SELECCIONADO.id, client_id: CLIENT_ID, has_client_secret: true }));
    const progreso = llamadas("/api/onboarding/progress").filter(([, , , init]) => init?.method === "PUT");
    expect(progreso.map(([, , , init]) => JSON.parse(String(init.body)))).toContainEqual({ step: "step_azure_sp", status: "completed" });
  });

  it("válido pero el guardado falla: lo dice y NO marca el paso como completado", async () => {
    servidor({
      ...base,
      "/api/admin/diagnose-sp": () => json({ success: true, subscriptions: 1, names: ["Producción"] }),
      "/api/tenants": () => json({ error: "Fallo al actualizar Tenant" }, 500),
    });
    await abrirPaso2YCompletar();
    validar();
    expect(await screen.findByText(T.spErrSaveFailed)).toBeTruthy();
    expect(mocks.setSelectedTenant).not.toHaveBeenCalled();
    expect(llamadas("/api/onboarding/progress").filter(([, , , init]) => init?.method === "PUT")).toHaveLength(0);
  });
});

describe("paso 3: primera sincronización", () => {
  async function irAlPaso3() {
    render(<OnboardingPage />);
    const empezar = await screen.findAllByRole("button", { name: T.start });
    fireEvent.click(empezar[1]); // paso 3: el 1 era el paso 2 (el paso 1 está activo y no tiene "Empezar")
  }

  it("llama a la ruta que existe, con el tenant seleccionado, y marca el paso cuando el job arrancó", async () => {
    servidor({ ...base, "/api/admin/config/account-status/sync-now": () => json({ success: true, jobId: "j1" }) });
    await irAlPaso3();
    fireEvent.click(await screen.findByRole("button", { name: T.runSync }));
    await waitFor(() => expect(llamadas("/api/admin/config/account-status/sync-now")).toHaveLength(1));
    const [, , , init] = llamadas("/api/admin/config/account-status/sync-now")[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ tenantId: SELECCIONADO.id });
    await waitFor(() =>
      expect(llamadas("/api/onboarding/progress").map(([, , , i]) => i?.body && JSON.parse(String(i.body)))).toContainEqual({ step: "step_first_sync", status: "completed" })
    );
  });

  it("si el job no arranca (la ruta contesta error) avisa con el motivo y NO marca el paso como completado", async () => {
    servidor({ ...base, "/api/admin/config/account-status/sync-now": () => json({ error: "La sincronización manual no está configurada en este entorno" }, 503) });
    await irAlPaso3();
    fireEvent.click(await screen.findByRole("button", { name: T.runSync }));
    await waitFor(() => expect(globalThis.alert).toHaveBeenCalledWith("La sincronización manual no está configurada en este entorno"));
    expect(llamadas("/api/onboarding/progress").filter(([, , , i]) => i?.method === "PUT")).toHaveLength(0);
  });

  it("una ruta que contesta con HTML cae en el aviso genérico, tampoco completa el paso", async () => {
    servidor({ ...base, "/api/admin/config/account-status/sync-now": () => new Response("<html>502</html>", { status: 502 }) });
    await irAlPaso3();
    fireEvent.click(await screen.findByRole("button", { name: T.runSync }));
    await waitFor(() => expect(globalThis.alert).toHaveBeenCalledWith(T.syncStartFailed));
    expect(llamadas("/api/onboarding/progress").filter(([, , , i]) => i?.method === "PUT")).toHaveLength(0);
  });
});
