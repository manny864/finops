import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { UNIFIED_AUDIT_RESOURCE_CONFIG } from "@/lib/zombieAuditCatalog";

const issues = (locale: string) =>
  JSON.parse(readFileSync(`messages/${locale}.json`, "utf-8")).Zombies.issues as Record<string, string>;

describe("badges de la tabla de fugas", () => {
  it("cada regla del catalogo tiene traduccion en los tres idiomas", () => {
    // ZombieResourcesTable renderiza t(`issues.${issueKey}`) con fallback al
    // texto en español del catalogo. Una clave sin entrada no rompe: dibuja el
    // español, que es justamente el bug que se estaba arreglando.
    for (const locale of ["es", "en", "pt-BR"]) {
      const faltan = Object.keys(UNIFIED_AUDIT_RESOURCE_CONFIG).filter((k) => !issues(locale)[k]);
      expect(faltan, `${locale} sin traducir`).toEqual([]);
    }
  });

  it("ninguna traduccion inglesa quedo igual al español", () => {
    const es = issues("es");
    const en = issues("en");
    const iguales = Object.keys(UNIFIED_AUDIT_RESOURCE_CONFIG).filter((k) => es[k] === en[k]);
    expect(iguales).toEqual([]);
  });
});
