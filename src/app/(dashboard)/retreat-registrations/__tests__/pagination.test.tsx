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

let registrationsData: unknown[] = [];
let registrationsCount: number | null = 45;
let paymentsData: unknown[] = [];

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
      return Promise.resolve({ data: registrationsData, count: registrationsCount, error: null }).then(
        resolve as never,
        reject as never,
      );
    }
    return Promise.resolve({ data: paymentsData, error: null }).then(
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

describe("retreat-registrations pagination (PR2 T-005)", () => {
  afterEach(() => cleanup());
  beforeEach(() => {
    vi.clearAllMocks();
    registrationsData = Array.from({ length: 20 }, (_, i) => ({
      id: `id-${i}`,
      name: `Name ${i}`,
      email: `email${i}@example.com`,
      phone: `300000000${i}`,
      birthday: null,
      is_minor: false,
      legal_rep_name: null,
      status: "inscrito",
      created_at: "2026-08-10T10:00:00Z",
      transferred_at: null,
      transferred_member_id: null,
      member_id: null,
    }));
    paymentsData = [];
    mockFrom.mockImplementation((table: string) => makeChain(table));
  });

  it("range(20,39) on page 2 count:'exact'", async () => {
    const Page = (await import("../page")).default;
    render(<Page />);
    await waitFor(() => expect(mockSelect).toHaveBeenCalled());
    expect(mockRange).toHaveBeenCalledWith(0, 19);
    const next = await screen.findByRole("button", { name: /Siguiente/i });
    fireEvent.click(next);
    await waitFor(() => expect(mockRange).toHaveBeenCalledWith(20, 39));
  });

  it("eq('status','inscrito') on tab Inscritos", async () => {
    const Page = (await import("../page")).default;
    render(<Page />);
    await waitFor(() => expect(mockSelect).toHaveBeenCalled());
    const inscritosTab = await screen.findByRole("tab", { name: /^Inscritos$/i });
    fireEvent.click(inscritosTab);
    await waitFor(() => expect(mockEq).toHaveBeenCalledWith("status", "inscrito"));
  });

  it("or ilike %ana% after debounce", async () => {
    const Page = (await import("../page")).default;
    render(<Page />);
    const input = await screen.findByPlaceholderText(/Buscar por nombre/i);
    fireEvent.change(input, { target: { value: "ana" } });
    await waitFor(() => expect(mockOr).toHaveBeenCalledWith(expect.stringContaining("ana")), { timeout: 2000 });
    expect(mockOr).toHaveBeenCalledWith("name.ilike.%ana%,email.ilike.%ana%,phone.ilike.%ana%");
  });

  it("in(visibleIds) bounded by pageSize not full scan", async () => {
    const Page = (await import("../page")).default;
    render(<Page />);
    await waitFor(() => expect(mockIn).toHaveBeenCalled());
    const callArg = mockIn.mock.calls[0][1] as string[];
    expect(Array.isArray(callArg)).toBe(true);
    expect(callArg.length).toBe(20);
    expect(callArg[0]).toBe("id-0");
  });
});
