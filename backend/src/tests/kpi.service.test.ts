import { getKpiCatalog, DIMENSIONS, METRICS, queryKpis } from "../modules/kpi/kpi.service";
import { exportToCsv } from "../modules/kpi/kpi-export.service";

describe("kpi.service — whitelist de dimensiones y métricas", () => {
  it("expone un catálogo cerrado de dimensiones y métricas para el frontend", () => {
    const catalog = getKpiCatalog();
    expect(catalog.dimensions.length).toBe(Object.keys(DIMENSIONS).length);
    expect(catalog.metrics.length).toBe(Object.keys(METRICS).length);
    expect(catalog.periods).toEqual(["day", "week", "month"]);
  });

  it("todas las métricas del catálogo declaran su SQL de agregación y una etiqueta legible", () => {
    for (const [, def] of Object.entries(METRICS)) {
      expect(def.sql).toBeTruthy();
      expect(def.label).toBeTruthy();
    }
  });

  it("las claves de DIMENSIONS mapean a nombres de columna snake_case reales de la vista", () => {
    for (const value of Object.values(DIMENSIONS)) {
      expect(value).toMatch(/^[a-z_]+$/); // nunca camelCase, nunca con espacios/símbolos
    }
  });
});

// Nota: el rechazo de claves no reconocidas ocurre ANTES de tocar la BD
// (bucle de validación al inicio de queryKpis), así que se puede testear
// sin depender de que la vista materializada exista en el entorno de test.
describe("queryKpis — validación de entrada (whitelist)", () => {
  const baseParams = {
    companyId: "any-company",
    from: new Date("2026-01-01"),
    to: new Date("2026-01-31"),
    dimensions: [] as any,
    metrics: [] as any,
  };

  it("rechaza si no se pide ninguna métrica", async () => {
    await expect(queryKpis({ ...baseParams, metrics: [] })).rejects.toThrow(
      "Se requiere al menos una métrica"
    );
  });

  it("rechaza una métrica no reconocida (SQL injection surface cerrada)", async () => {
    await expect(
      queryKpis({ ...baseParams, metrics: ["dropTablesPlz" as any] })
    ).rejects.toThrow(/Métrica no reconocida/);
  });

  it("rechaza una dimensión no reconocida", async () => {
    await expect(
      queryKpis({
        ...baseParams,
        metrics: ["otifPct"] as any,
        dimensions: ["'; DROP TABLE mv_kpi_shipment_facts; --" as any],
      })
    ).rejects.toThrow(/Dimensión no reconocida/);
  });

  it("rechaza una granularidad de periodo no reconocida", async () => {
    await expect(
      queryKpis({ ...baseParams, metrics: ["otifPct"] as any, period: "fortnight" as any })
    ).rejects.toThrow(/Granularidad de periodo no reconocida/);
  });
});

describe("exportToCsv", () => {
  it("genera cabecera y filas correctamente escapadas", () => {
    const csv = exportToCsv([
      { carrierId: "Transportes García, S.L.", otifPct: 95.5 },
      { carrierId: 'Con "comillas"', otifPct: 88 },
    ]);

    const lines = csv.split("\n");
    expect(lines[0]).toBe("carrierId,otifPct");
    expect(lines[1]).toBe('"Transportes García, S.L.",95.5');
    expect(lines[2]).toBe('"Con ""comillas""",88');
  });

  it("devuelve cadena vacía si no hay filas, sin lanzar error", () => {
    expect(exportToCsv([])).toBe("");
  });
});
