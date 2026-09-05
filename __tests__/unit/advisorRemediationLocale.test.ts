import { describe, it, expect } from "vitest";
import { generateAdvisorRemediationAction } from "@/lib/advisorRemediation";

const reserva = { resourceName: "vm-prod-01", titleTranslated: "Buy reserved instances", monthlySavingsUSD: 120 };
const rightsize = {
  resourceName: "vm-app-02",
  titleTranslated: "Right-size the underutilized virtual machine",
  resource: { resourceType: "microsoft.compute/virtualmachines" } as any,
  extendedProperties: { targetSku: "Standard_D2s_v5" } as any,
};

describe("generateAdvisorRemediationAction — idioma", () => {
  it("sin locale sigue devolviendo español", () => {
    const a = generateAdvisorRemediationAction(reserva);
    expect(a.actionTitle).toBe("Adquirir Instancia Reservada / Savings Plan");
    expect(a.actionDescription).toContain("vm-prod-01");
  });

  it("traduce titulo y descripcion en en y pt-BR", () => {
    expect(generateAdvisorRemediationAction(reserva, "en").actionTitle)
      .toBe("Purchase a Reserved Instance / Savings Plan");
    expect(generateAdvisorRemediationAction(reserva, "pt-BR").actionDescription)
      .toContain("tarifa reservada");
    // en-US / pt debe normalizar igual que en / pt-BR
    expect(generateAdvisorRemediationAction(reserva, "en-US").actionTitle)
      .toBe(generateAdvisorRemediationAction(reserva, "en").actionTitle);
  });

  it("interpola el titulo de RIGHTSIZE, que lleva placeholders", () => {
    // Antes el titulo se armaba con template literal en el llamador y por eso
    // no se podia traducir. Ahora es plantilla: si no se interpolara, los
    // {name}/{skuSuffix} llegarian crudos a la pantalla.
    for (const [loc, esperado] of [["es", "Redimensionar vm-app-02 a Standard_D2s_v5"],
                                   ["en", "Resize vm-app-02 to Standard_D2s_v5"]] as const) {
      const a = generateAdvisorRemediationAction(rightsize, loc);
      expect(a.actionTitle).toBe(esperado);
      expect(a.actionTitle).not.toContain("{");
    }
  });

  it("el descriptionTemplate sale localizado, que es lo que cachea la narracion por ruleKey+locale", () => {
    const en = generateAdvisorRemediationAction(reserva, "en");
    expect(en.descriptionTemplate).toContain("{name}");
    expect(en.descriptionTemplate).toContain("reserved rates");
  });

  it("una regla sin traduccion cae al español en vez de quedar vacia", () => {
    // El fallback es lo que permite escribir una regla nueva hoy y traducirla
    // despues sin que la pantalla quede en blanco mientras tanto.
    const sinTraduccion = { ...reserva, actionTitleOverride: undefined };
    const a = generateAdvisorRemediationAction(sinTraduccion, "de");
    expect(a.actionTitle).toBe("Adquirir Instancia Reservada / Savings Plan");
  });

  it("el recurso sin nombre usa el articulo del idioma, no 'el recurso' fijo", () => {
    const anon = { titleTranslated: "Review this", resourceName: "—" };
    expect(generateAdvisorRemediationAction(anon, "en").actionDescription).toContain("the resource");
    expect(generateAdvisorRemediationAction(anon, "es").actionDescription).toContain("el recurso");
  });
});
