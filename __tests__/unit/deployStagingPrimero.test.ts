// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Staging primero: un push a main despliega SÓLO staging y prod se promueve a mano. Estas invariantes cuidan que nadie
 * deshaga eso por accidente (un nombre de prod pegado en el workflow equivocado, un trigger agregado, una guarda borrada).
 */
const leer = (f: string) => readFileSync(`.github/workflows/${f}`, "utf8");
const push = leer("deploy-azure.yml");
const promover = leer("promote-prod.yml");
const plantilla = leer("_deploy.yml");

const RECURSOS_PROD = ["cscsfinopsprodglobalcr", "cscs-finops-prod-westus2-rg", "cscs-finops-prod-westus2-web", "cscs-finops-prod-wus2-migrate"];
const RECURSOS_STAGING = ["cscsfinopsstgglobalcr", "cscs-finops-stg-westus2-rg", "cscs-finops-stg-westus2-web", "cscs-finops-stg-wus2-migrate"];

/** El workflow sin líneas de comentario: las guardas hablan de prod en los comentarios y eso no cuenta. */
const sinComentarios = (t: string) => t.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("deploy-azure.yml (push a main) despliega sólo staging", () => {
  it.each(RECURSOS_PROD)("no nombra el recurso de prod %s", (r) => {
    expect(push).not.toContain(r);
  });

  it("no usa el environment prod", () => {
    expect(sinComentarios(push)).not.toMatch(/environment:\s*prod\b/);
  });

  it("llama a la plantilla con los recursos de staging", () => {
    expect(push).toContain("uses: ./.github/workflows/_deploy.yml");
    expect(push).toContain("environment: staging");
    for (const r of RECURSOS_STAGING) expect(push).toContain(r);
  });

  it("su concurrencia es la de staging, no la de prod", () => {
    expect(push).toContain("group: deploy-staging");
    expect(push).not.toContain("group: deploy-prod");
  });

  it("antes de desplegar, falla si una NEXT_PUBLIC_* cayó a la de prod o el token de Paddle no es del sandbox", () => {
    expect(push).toContain("guardas-staging");
    expect(push).toMatch(/needs:\s*guardas-staging/);
    expect(push).toContain('"$STG" = "$PROD"');
    expect(push).toContain("test_*)");
    // El job que lee los valores de prod NO declara environment: ahí `vars` es el nivel de repositorio.
    const job = push.slice(push.indexOf("  valores-de-prod:"), push.indexOf("  guardas-staging:"));
    expect(job).not.toContain("environment:");
  });

  it("sólo se dispara por push a main o a mano", () => {
    const on = push.slice(push.indexOf("\non:"), push.indexOf("\npermissions:"));
    expect(on).toMatch(/push:\s*\n\s*branches:\s*\[main\]/);
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(/\bpull_request|\bschedule:|workflow_run/);
  });

  it("ni la guarda ni el deploy de staging se pueden saltear con un `if:`", () => {
    const desdeGuardas = push.slice(push.indexOf("  guardas-staging:"));
    expect(desdeGuardas).not.toMatch(/^\s+if:/m);
  });

  it("espera a la puerta de calidad antes de tocar Azure", () => {
    expect(push).toMatch(/valores-de-prod:\s*\n\s*needs:\s*verificacion/);
  });
});

describe("promote-prod.yml es la única forma de desplegar prod", () => {
  it("sólo se dispara a mano", () => {
    const on = promover.slice(promover.indexOf("\non:"), promover.indexOf("\npermissions:"));
    expect(on).toContain("workflow_dispatch:");
    expect(on).not.toMatch(/\bpush:|\bpull_request|\bschedule:|workflow_run/);
  });

  it("exige exactamente PROMOTE-PROD antes de hacer nada", () => {
    expect(promover).toContain('[ "$CONFIRM" = "PROMOTE-PROD" ]');
    const confirmacion = promover.indexOf("PROMOTE-PROD\" ]");
    expect(confirmacion).toBeGreaterThan(0);
    expect(confirmacion).toBeLessThan(promover.indexOf("deploy-prod:"));
  });

  it("sólo promueve un commit de main con un deploy a staging exitoso", () => {
    expect(promover).toMatch(/git merge-base --is-ancestor "\$SHA" origin\/main \|\|/);
    expect(promover).toContain("--workflow deploy-azure.yml");
    expect(promover).toMatch(/--status success\b/);
    expect(promover).toMatch(/\^\[0-9a-f\]\{40\}\$/);
  });

  it("despliega con la plantilla y los recursos de prod, en el environment prod, esperando la verificación", () => {
    const job = promover.slice(promover.indexOf("  deploy-prod:"));
    expect(job).toMatch(/needs:\s*verificar-promocion/);
    expect(job).toContain("uses: ./.github/workflows/_deploy.yml");
    expect(job).toContain("environment: prod");
    expect(job).toContain("sha: ${{ inputs.sha }}");
    for (const r of RECURSOS_PROD) expect(job).toContain(r);
    for (const r of RECURSOS_STAGING) expect(promover).not.toContain(r);
  });

  it("no cancela una promoción en curso (la migración ya disparada seguiría corriendo)", () => {
    expect(promover).toContain("group: deploy-prod");
    expect(promover).toContain("cancel-in-progress: false");
  });
});

describe("_deploy.yml (plantilla compartida)", () => {
  it.each([...RECURSOS_PROD, ...RECURSOS_STAGING])("no lleva el nombre de recurso %s: lo trae el llamador", (r) => {
    expect(plantilla).not.toContain(r);
  });

  it("construye y despliega el sha pedido, nunca el de la ref del workflow", () => {
    expect(plantilla).not.toContain("github.sha");
    expect(plantilla).toContain("ref: ${{ inputs.sha }}");
    expect(plantilla).toContain('APP_VERSION="${{ inputs.sha }}"');
  });

  it("valida que el sha sea un hash antes de interpolarlo en un script", () => {
    const validacion = plantilla.indexOf("^[0-9a-f]{40}$");
    expect(validacion).toBeGreaterThan(0);
    expect(validacion).toBeLessThan(plantilla.indexOf("docker build"));
  });

  it("el environment sale de la entrada del llamador", () => {
    expect(plantilla).toContain("environment: ${{ inputs.environment }}");
  });

  it("mantiene las migraciones antes del deploy y el health check al final", () => {
    const m = plantilla.indexOf("name: Migraciones");
    const d = plantilla.indexOf("name: Deploy de la app");
    const h = plantilla.indexOf("name: Health check");
    expect(m).toBeGreaterThan(0);
    expect(d).toBeGreaterThan(m);
    expect(h).toBeGreaterThan(d);
  });
});
