import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";

const mockSelect = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockOrder = vi.hoisted(() => vi.fn());
const mockRange = vi.hoisted(() => vi.fn());
const mockOr = vi.hoisted(() => vi.fn());
const mockIn = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/useRole", () => ({
  useRole: () => ({ role: "leader", loading: false }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: mockFrom,
    auth: {
      getSession: vi.fn().mockResolvedValue({ data: { session: { user: { id: "uid" } } } }),
      onAuthStateChange: vi.fn().mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } }),
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

const validRow = {
  id: "id-0",
  name: "Name 0",
  email: "email0@example.com",
  phone: "3000000000",
  birthday: null,
  is_minor: false,
  legal_rep_name: null,
  status: "preinscrito",
  created_at: "2026-08-10T10:00:00Z",
  transferred_at: null,
  transferred_member_id: null,
  member_id: null,
};

let registrationsData: unknown[] = [];
let registrationsCount: number | null = 1;
let registrationsError: { message: string } | null = null;
let paymentsData: unknown[] = [];
let paymentsError: { message: string } | null = null;

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
        data: registrationsError ? null : registrationsData,
        count: registrationsError ? null : registrationsCount,
        error: registrationsError,
      }).then(resolve as never, reject as never);
    }
    return Promise.resolve({
      data: paymentsError ? null : paymentsData,
      error: paymentsError,
    }).then(resolve as never, reject as never);
  };
  mockSelect.mockReturnValue(chain);
  mockEq.mockReturnValue(chain);
  mockOrder.mockReturnValue(chain);
  mockRange.mockReturnValue(chain);
  mockOr.mockReturnValue(chain);
  mockIn.mockReturnValue(chain);
  return chain;
}

describe("retreat-registrations load error surfacing (incident: silent empty table)", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    registrationsData = [validRow];
    registrationsCount = 1;
    registrationsError = null;
    paymentsData = [];
    paymentsError = null;
    mockFrom.mockImplementation((table: string) => makeChain(table));
  });

  it("T1: registrations query error shows the error banner, never the empty-state", async () => {
    registrationsData = [];
    registrationsCount = 0;
    registrationsError = { message: "JWT expired" };
    const Page = (await import("../page")).default;
    render(<Page />);

    await waitFor(() =>
      expect(screen.getByText(/No se pudieron cargar los datos de las preinscripciones/i)).toBeTruthy(),
    );
    expect(screen.getByText(/JWT expired/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Reintentar/i })).toBeTruthy();
    expect(screen.queryByText(/No hay preinscripciones registradas/i)).toBeNull();
  });

  it("T2: payments query error shows the banner and renders no partial rows", async () => {
    paymentsError = { message: "fetch failed" };
    const Page = (await import("../page")).default;
    render(<Page />);

    await waitFor(() =>
      expect(screen.getByText(/No se pudieron cargar los datos de las preinscripciones/i)).toBeTruthy(),
    );
    expect(screen.getByText(/fetch failed/i)).toBeTruthy();
    expect(screen.queryByText(/Name 0/i)).toBeNull();
    expect(screen.queryByText(/No hay preinscripciones registradas/i)).toBeNull();
  });

  it("T3: Reintentar after a failed load recovers the rows when the query succeeds", async () => {
    registrationsError = { message: "JWT expired" };
    const Page = (await import("../page")).default;
    render(<Page />);

    await waitFor(() =>
      expect(screen.getByText(/No se pudieron cargar los datos de las preinscripciones/i)).toBeTruthy(),
    );

    registrationsError = null;
    fireEvent.click(screen.getByRole("button", { name: /Reintentar/i }));

    await waitFor(() =>
      expect(screen.queryByText(/No se pudieron cargar los datos de las preinscripciones/i)).toBeNull(),
    );
    await waitFor(() => expect(screen.getByText(/Name 0/i)).toBeTruthy());
  });
});
