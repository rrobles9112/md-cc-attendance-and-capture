import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const toastSuccessMock = vi.hoisted(() => vi.fn());
const toastErrorMock = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockEq = vi.hoisted(() => vi.fn());
const mockSelect = vi.hoisted(() => vi.fn());

vi.mock("sonner", () => ({
  toast: {
    success: toastSuccessMock,
    error: toastErrorMock,
    warning: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      update: mockUpdate,
    }),
  }),
}));

function installPolyfills() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-ignore
  globalThis.ResizeObserver = ResizeObserverStub;
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
}

const sample = {
  id: "reg-1",
  name: "Ana Pérez",
  email: "ana@example.com",
  phone: "3001234567",
  birthday: "2000-01-15",
  legal_rep_name: null as string | null,
  has_whatsapp: false,
  whatsapp_number: null as string | null,
  has_medical_conditions: false,
  medical_conditions: null as string | null,
  medical_medications: null as string | null,
  medical_dosage: null as string | null,
};

import { RetreatPreinscriptionEdit } from "../RetreatPreinscriptionEdit";

describe("RetreatPreinscriptionEdit", () => {
  beforeEach(() => {
    installPolyfills();
    vi.clearAllMocks();
    mockUpdate.mockReturnValue({ eq: mockEq });
    mockEq.mockReturnValue({ select: mockSelect });
    mockSelect.mockResolvedValue({ data: [{ id: "reg-1" }], error: null });
  });

  it("prefills identity fields and saves an update", async () => {
    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RetreatPreinscriptionEdit
        registration={sample}
        open
        onOpenChange={onOpenChange}
        onSaved={onSaved}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Editar preinscripción" }),
    ).toBeInTheDocument();
    const nameInput = screen.getByLabelText("Nombre") as HTMLInputElement;
    expect(nameInput.value).toBe("Ana Pérez");
    fireEvent.change(nameInput, { target: { value: "Ana María Pérez" } });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Ana María Pérez",
        phone: "3001234567",
        email: "ana@example.com",
      }),
    );
    await waitFor(() =>
      expect(toastSuccessMock).toHaveBeenCalledWith(
        "Preinscripción actualizada",
      ),
    );
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("reveals medical fields when the checkbox is checked and saves them", async () => {
    const onSaved = vi.fn();
    render(
      <RetreatPreinscriptionEdit
        registration={sample}
        open
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
    );
    expect(
      screen.queryByLabelText(/¿Cuáles condiciones/),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText("Tiene alguna condición médica"));
    const conditionsInput = screen.getByLabelText(
      /¿Cuáles condiciones/,
    ) as HTMLInputElement;
    fireEvent.change(conditionsInput, { target: { value: "Asma" } });
    fireEvent.change(screen.getByLabelText("Medicamentos"), {
      target: { value: "Salbutamol" },
    });
    fireEvent.change(screen.getByLabelText("Dosis / cada cuántas horas"), {
      target: { value: "Cada 8 horas" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledTimes(1));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        has_medical_conditions: true,
        medical_conditions: "Asma",
        medical_medications: "Salbutamol",
        medical_dosage: "Cada 8 horas",
      }),
    );
  });

  it("shows a validation toast and does not persist empty names", async () => {
    const onSaved = vi.fn();
    render(
      <RetreatPreinscriptionEdit
        registration={sample}
        open
        onOpenChange={vi.fn()}
        onSaved={onSaved}
      />,
    );
    fireEvent.change(screen.getByLabelText("Nombre"), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar" }));
    await waitFor(() => expect(toastErrorMock).toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
