import { describe, expect, it } from "vitest";
import { rangesOverlap } from "../lib/rate-validity";

describe("rangesOverlap", () => {
  it("detecta solape simple entre dos rangos cerrados", () => {
    const a = [new Date("2025-01-01"), new Date("2025-06-30")] as const;
    const b = [new Date("2025-06-01"), new Date("2025-12-31")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("no detecta solape entre rangos consecutivos sin intersección", () => {
    const a = [new Date("2025-01-01"), new Date("2025-05-31")] as const;
    const b = [new Date("2025-06-01"), new Date("2025-12-31")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(false);
  });

  it("trata validTo=null como vigente indefinidamente (solapa con cualquier fecha posterior)", () => {
    const a = [new Date("2025-01-01"), null] as const;
    const b = [new Date("2030-01-01"), new Date("2030-12-31")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("dos vigencias indefinidas siempre solapan", () => {
    const a = [new Date("2025-01-01"), null] as const;
    const b = [new Date("2026-01-01"), null] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(true);
  });

  it("es simétrica (a,b) === (b,a)", () => {
    const a = [new Date("2025-03-01"), new Date("2025-03-31")] as const;
    const b = [new Date("2025-03-15"), new Date("2025-04-15")] as const;
    expect(rangesOverlap(a[0], a[1], b[0], b[1])).toBe(rangesOverlap(b[0], b[1], a[0], a[1]));
  });
});
