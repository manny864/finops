// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { getMockDataForRoute } from "@/lib/mockData";

const RAIZ = join(__dirname, "..", "..");
const sin = (p: string) =>
  readFileSync(join(RAIZ, p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("MEJ-41: Selector de rango temporal (30D/90D) y persistencia en Whiteboard", () => {
  const board = sin("src/components/dashboard/ExecutiveSummaryBoard.tsx");
  const overviewRoute = sin("src/app/api/overview/whiteboard/route.ts");
  const intelligenceRoute = sin("src/app/api/intelligence/whiteboard/route.ts");

  it("el hook SWR en ExecutiveSummaryBoard envía timeRange al endpoint", () => {
    expect(board).toContain("&timeRange=${timeRange}");
  });

  it("el refresco forzado (bust=1) preserva el timeRange seleccionado", () => {
    const fnRefrescar = board.slice(
      board.indexOf("const refrescarDeVerdad = useCallback"),
      board.indexOf("const summarySub =")
    );
    expect(fnRefrescar).toContain("&timeRange=${timeRange}");
    expect(fnRefrescar).toContain("timeRange");
  });

  it("el resumen global de respaldo solo se consulta cuando timeRange === MTD", () => {
    expect(board).toContain('timeRange === "MTD"');
  });

  it("la ruta overview particiona la clave de Redis por timeRange", () => {
    expect(overviewRoute).toContain("searchParams.get('timeRange') || 'MTD'");
    expect(overviewRoute).toMatch(/cacheKey\s*=\s*`whiteboard:v4:\${tenantId}:\${locale}:\${timeRange}:/);
  });

  it("la ruta intelligence consulta CostSnapshots con INTERVAL para 30D y 90D", () => {
    expect(intelligenceRoute).toContain("INTERVAL 30 DAY");
    expect(intelligenceRoute).toContain("INTERVAL 90 DAY");
    expect(intelligenceRoute).toContain('timeRange === "90D"');
    expect(intelligenceRoute).toContain('timeRange === "30D"');
  });

  it("los datos mock escalan el costo del periodo para 90D y 30D", () => {
    const mockMtd = getMockDataForRoute("white_board", "mock-tenant-id", "es", { timeRange: "MTD" });
    const mock90D = getMockDataForRoute("white_board", "mock-tenant-id", "es", { timeRange: "90D" });

    expect(mockMtd.summary.timeRange).toBe("MTD");
    expect(mock90D.summary.timeRange).toBe("90D");
    expect(mock90D.summary.costPeriodUSD).toBeGreaterThan(mockMtd.summary.costPeriodUSD);
  });
});
