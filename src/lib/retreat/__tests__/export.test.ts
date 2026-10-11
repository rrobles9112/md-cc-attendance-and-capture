import { describe, expect, it } from "vitest";
import { buildReportRows } from "../export";

describe("buildReportRows emergency contact", () => {
  it("maps the emergency contact columns", () => {
    const rows = buildReportRows(
      [
        {
          name: "Ana Pérez",
          email: "ana@example.com",
          phone: "3001234567",
          birthday: "2000-01-15",
          is_minor: false,
          legal_rep_name: null,
          status: "preinscrito",
          transferred_at: null,
          emergency_contact_name: "Rosa Pérez",
          emergency_contact_relationship: "madre",
          emergency_contact_phone: "3009998877",
        },
      ],
      new Map(),
      null,
      ["reg-1"],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].ContactoEmergencia).toBe("Rosa Pérez");
    expect(rows[0].ParentescoEmergencia).toBe("madre");
    expect(rows[0].CelularEmergencia).toBe("3009998877");
  });

  it("keeps emergency columns empty when absent", () => {
    const rows = buildReportRows(
      [
        {
          name: "Ana Pérez",
          email: "ana@example.com",
          phone: "3001234567",
          birthday: "2000-01-15",
          is_minor: false,
          legal_rep_name: null,
          status: "preinscrito",
          transferred_at: null,
        },
      ],
      new Map(),
      null,
      ["reg-1"],
    );
    expect(rows[0].ContactoEmergencia).toBe("");
    expect(rows[0].ParentescoEmergencia).toBe("");
    expect(rows[0].CelularEmergencia).toBe("");
  });
});
