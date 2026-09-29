import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Export modes of the retreat report: estado de pago / inscritos / preinscritos.
 *
 * The three buttons must differ in exactly one place that matters - the status
 * filter sent to PostgREST - and in the file name they produce. The active
 * search filter belongs to the "estado" report only; pinned here so a future
 * refactor of `exportMode` cannot silently widen or narrow the other two.
 */

const mockSelect = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockOrder = vi.hoisted(() => vi.fn());
const mockRange = vi.hoisted(() => vi.fn());
const mockOr = vi.hoisted(() => vi.fn());
const mockIn = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());
const mockXlsx = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({ role: "super_admin", loading: false }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      getSession: vi
        .fn()
        .mockResolvedValue({ data: { session: { user: { id: "uid" } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({
        data: { subscription: { unsubscribe: vi.fn() } },
      }),
    },
  }),
}));

vi.mock("@/lib/settings/app-settings", () => ({
  getRetreatTotalCost: vi.fn().mockResolvedValue("400000"),
  setRetreatTotalCost: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/retreat-registrations",
}));

vi.mock("@/lib/retreat/export", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/retreat/export")>();
  return {
    ...actual,
    exportRetreatToXLSX: mockXlsx,
    formatYYYYMMDD: (d: Date) => actual.formatYYYYMMDD(d),
  };
});

let registrationsData: unknown[] = [];

function makeChain(table: string) {
  const chain: Record<string, unknown> = {};
  chain.select = mockSelect;
  chain.eq = mockEq;
  chain.order = mockOrder;
  chain.range = mockRange;
  chain.or = mockOr;
  chain.in = mockIn;

  (chain as unknown as { then: unknown }).then = (
    resolve: (value: unknown) => unknown,
    reject: (reason: unknown) => unknown,
  ) => {
    if (table === "retreat_registrations") {
      return Promise.resolve({
        data: registrationsData,
        count: registrationsData.length,
        error: null,
      }).then(resolve as never, reject as never);
    }
    return Promise.resolve({ data: [], error: null }).then(
      resolve as never,
      reject as never,
    );
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockRange.mockReturnValue(chain);
  mockOr.mockReturnValue(chain);
  mockIn.mockReturnValue(chain);
  return chain;
}

function eqCalls(field: string): string[] {
  return mockEq.mock.calls
    .filter((c) => c[0] === field)
    .map((c) => String(c[1]));
}

async function renderPage() {
  const Page = (await import("../page")).default;
  render(<Page />);
  await waitFor(() => expect(mockSelect).toHaveBeenCalled());
  await screen.findByRole("table");
}

describe("retreat-registrations export modes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockImplementation((table: string) => makeChain(table));
    registrationsData = [
      {
        id: "id-0",
        name: "Asistente 0",
        email: "asistente0@example.com",
        phone: "3001000000",
        birthday: null,
        is_minor: false,
        legal_rep_name: null,
        status: "preinscrito",
        created_at: "2026-08-10T10:00:00Z",
        transferred_at: null,
        transferred_member_id: null,
        member_id: null,
        has_medical_conditions: false,
        medical_conditions: null,
        medical_medications: null,
        medical_dosage: null,
      },
    ];
  });

  afterEach(() => {
    cleanup();
  });

  it("Exportar preinscritos filters status=preinscrito and names the file accordingly", async () => {
    await renderPage();

    fireEvent.click(
      await screen.findByRole("button", { name: /Exportar preinscritos/i }),
    );

    await waitFor(() => expect(mockXlsx).toHaveBeenCalled());
    expect(eqCalls("status")).toContain("preinscrito");
    expect(eqCalls("status")).not.toContain("inscrito");

    const filename = String(mockXlsx.mock.calls[0][1]);
    expect(filename.startsWith("retiro-preinscritos-")).toBe(true);
  });

  it("Exportar inscritos keeps filtering status=inscrito", async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Exportar inscritos/i }));

    await waitFor(() => expect(mockXlsx).toHaveBeenCalled());
    expect(eqCalls("status")).toContain("inscrito");
    expect(String(mockXlsx.mock.calls[0][1]).startsWith("retiro-inscritos-")).toBe(
      true,
    );
  });

  it("Exportar estado de pago keeps honouring the active search filter", async () => {
    await renderPage();

    const input = await screen.findByPlaceholderText(/Buscar por nombre/i);
    fireEvent.change(input, { target: { value: "ana" } });
    await waitFor(() =>
      expect(mockOr).toHaveBeenCalledWith(
        "name.ilike.%ana%,email.ilike.%ana%,phone.ilike.%ana%",
      ),
      { timeout: 2000 },
    );

    mockXlsx.mockClear();
    mockOr.mockClear();
    fireEvent.click(
      await screen.findByRole("button", { name: /Exportar estado de pago/i }),
    );

    await waitFor(() => expect(mockXlsx).toHaveBeenCalled());
    expect(mockOr).toHaveBeenCalled();
    expect(String(mockXlsx.mock.calls[0][1]).startsWith("retiro-estado-pago-")).toBe(
      true,
    );
  });

  it("Exportar preinscritos ignores the active search filter by design", async () => {
    await renderPage();

    const input = await screen.findByPlaceholderText(/Buscar por nombre/i);
    fireEvent.change(input, { target: { value: "ana" } });
    await waitFor(() => expect(mockOr).toHaveBeenCalled(), { timeout: 2000 });

    mockXlsx.mockClear();
    mockOr.mockClear();
    fireEvent.click(
      await screen.findByRole("button", { name: /Exportar preinscritos/i }),
    );

    await waitFor(() => expect(mockXlsx).toHaveBeenCalled());
    expect(mockOr).not.toHaveBeenCalled();
    expect(eqCalls("status")).toContain("preinscrito");
  });
});
