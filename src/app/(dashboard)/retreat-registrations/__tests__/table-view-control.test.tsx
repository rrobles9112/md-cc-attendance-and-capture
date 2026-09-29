import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

/**
 * Table-view control ("Vista de tabla").
 *
 * The contract this file protects:
 * 1. Header and body cells are gated by the SAME predicate, so hiding a column
 *    never shifts the remaining columns (a header-only filter misaligns rows).
 * 2. There is exactly ONE scroll container. shadcn's <Table> already wraps
 *    <table> in `div.relative.w-full.overflow-auto`; adding a second scroller on
 *    the page makes `TableHeader sticky top-0` resolve against the inner,
 *    content-height div, which never scrolls vertically. The page must push its
 *    height constraint onto that inner div (`[&>div]:...`) instead of scrolling
 *    itself.
 * 3. Density reaches every body cell, not just the first one.
 * 4. The empty-state colSpan follows the visible column count.
 *
 * Density/height are driven through localStorage because both are Radix Selects,
 * which do not open under jsdom; the derived classes are the real logic here.
 */

const STORAGE_KEY = "retiro-table-view-v1";

const mockSelect = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockOrder = vi.hoisted(() => vi.fn());
const mockRange = vi.hoisted(() => vi.fn());
const mockOr = vi.hoisted(() => vi.fn());
const mockIn = vi.hoisted(() => vi.fn());
const mockFrom = vi.hoisted(() => vi.fn());

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

let registrationsData: unknown[] = [];
let registrationsCount: number | null = 2;

/**
 * Deterministic storage: the jsdom build in this repo exposes no window.localStorage,
 * and the view preference is part of the contract under test.
 */
const viewStore = new Map<string, string>();
const storageStub = {
  getItem: (key: string) => (viewStore.has(key) ? (viewStore.get(key) as string) : null),
  setItem: (key: string, value: string) => void viewStore.set(key, String(value)),
  removeItem: (key: string) => void viewStore.delete(key),
  clear: () => viewStore.clear(),
  key: (index: number) => Array.from(viewStore.keys())[index] ?? null,
  get length() {
    return viewStore.size;
  },
};
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: storageStub,
});
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: storageStub,
});

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
        count: registrationsCount,
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

function seedRows(count: number) {
  registrationsData = Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    name: `Asistente ${i}`,
    email: `asistente${i}@example.com`,
    phone: `300${1000000 + i}`,
    birthday: null,
    is_minor: false,
    legal_rep_name: null,
    status: "inscrito",
    created_at: "2026-08-10T10:00:00Z",
    transferred_at: null,
    transferred_member_id: null,
    member_id: null,
    has_medical_conditions: i === 0,
    medical_conditions: i === 0 ? "Asma" : null,
    medical_medications: null,
    medical_dosage: null,
  }));
  registrationsCount = count;
}

function headerCells(): HTMLElement[] {
  return Array.from(document.querySelectorAll("thead th"));
}

function bodyCellCounts(): number[] {
  return Array.from(document.querySelectorAll("tbody tr")).map((row) =>
    row.querySelectorAll("td").length,
  );
}

function firstDataRowCells(): HTMLElement[] {
  const row = document.querySelector("tbody tr");
  return row ? Array.from(row.querySelectorAll("td")) : [];
}

/**
 * The page owns one wrapper div; shadcn's Table owns the div directly above
 * <table>. `wrapper` is the one the page controls.
 */
function tableWrapper(): HTMLElement {
  const table = document.querySelector("table");
  if (!table || !table.parentElement || !table.parentElement.parentElement) {
    throw new Error("table not rendered");
  }
  return table.parentElement.parentElement;
}

async function openTableView() {
  fireEvent.click(await screen.findByRole("button", { name: /Vista de tabla/i }));
  await screen.findByRole("dialog");
}

async function renderPage() {
  const Page = (await import("../page")).default;
  render(<Page />);
  await waitFor(() => expect(mockSelect).toHaveBeenCalled());
  await screen.findByRole("table");
}

describe("retreat-registrations table view control", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    viewStore.clear();
    seedRows(2);
    mockFrom.mockImplementation((table: string) => makeChain(table));
  });

  afterEach(() => {
    cleanup();
    viewStore.clear();
  });

  it("keeps header and body in sync with all columns visible (baseline)", async () => {
    await renderPage();

    const names = headerCells().map((th) => th.textContent?.trim());
    expect(names).toContain("Teléfono");
    expect(screen.getByText("3001000000")).toBeInTheDocument();
    expect(bodyCellCounts().length).toBe(2);
    expect(bodyCellCounts().every((n) => n === names.length)).toBe(true);
  });

  it("hiding a column removes its header AND its cells, rows stay aligned", async () => {
    await renderPage();
    await openTableView();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mostrar columna Teléfono" }),
    );

    await waitFor(() =>
      expect(
        screen.queryByRole("columnheader", { name: "Teléfono" }),
      ).toBeNull(),
    );
    expect(screen.queryByText("3001000000")).toBeNull();

    const visible = headerCells().length;
    const counts = bodyCellCounts();
    expect(visible).toBeGreaterThan(1);
    expect(counts.every((n) => n === visible)).toBe(true);
  });

  it("empty-state colSpan equals the visible column count after hiding two columns", async () => {
    seedRows(0);
    await renderPage();
    await openTableView();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mostrar columna Email" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mostrar columna Salud" }),
    );

    const cell = await waitFor(() => {
      const found = document.querySelector("tbody td");
      expect(found).not.toBeNull();
      return found as HTMLTableCellElement;
    });
    const visible = headerCells().length;
    expect(Number(cell.getAttribute("colspan"))).toBe(visible);
  });

  it("compact density applies to every body cell, not only the first one", async () => {
    viewStore.set(
      STORAGE_KEY,
      JSON.stringify({ density: "compacta", tableHeight: "encuadrada" }),
    );
    await renderPage();

    const cells = firstDataRowCells();
    // Nombre, Teléfono, Estado, Email, Pagado, ... — index 4 is "Pagado".
    expect(cells.length).toBeGreaterThan(5);
    const pagado = cells[4];
    expect(pagado.classList.contains("p-1")).toBe(true);
    expect(cells[0].classList.contains("p-1")).toBe(true);
  });

  it("persists the chosen column visibility on this device", async () => {
    await renderPage();
    await openTableView();

    fireEvent.click(
      screen.getByRole("checkbox", { name: "Mostrar columna Salud" }),
    );

    await waitFor(() => {
      const raw = viewStore.get(STORAGE_KEY);
      expect(raw).not.toBeNull();
      expect(JSON.parse(raw as string).columnVisibility.salud).toBe(false);
    });
  });

  it("uses a single scroll container so the sticky header can stick", async () => {
    await renderPage();

    const wrapper = tableWrapper();
    // The page wrapper must not be a scroll port of its own.
    expect(wrapper.className).not.toMatch(/(^|\s)overflow-auto/);
    expect(wrapper.className).not.toMatch(/(^|\s)max-h-/);
    // The height constraint belongs to shadcn's own scroller.
    expect(wrapper.className).toMatch(/\[&>div\]:max-h-\[calc\(/);
    expect(wrapper.className).toMatch(/\[&>div\]:overflow-auto/);
  });

  it("full-height mode drops the max-height constraint", async () => {
    viewStore.set(
      STORAGE_KEY,
      JSON.stringify({ density: "comoda", tableHeight: "completa" }),
    );
    await renderPage();

    const wrapper = tableWrapper();
    expect(wrapper.className).not.toMatch(/max-h-/);
  });
});
