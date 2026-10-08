import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CaptureForm } from "../CaptureForm";

const membersAddMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sync/db", () => ({
  db: {
    members: { add: membersAddMock },
    whatsapp_numbers: { add: vi.fn() },
    social_media: { add: vi.fn() },
  },
}));

vi.mock("@/lib/sync/queue", () => ({
  enqueue: enqueueMock,
}));

vi.mock("@/lib/audit/consent-logger", () => ({
  logGeneralConsent: vi.fn(),
  logSensitiveConsent: vi.fn(),
  logConsentEvent: vi.fn(),
}));

vi.mock("@/lib/sync/conflict", () => ({
  findDuplicateMembers: vi.fn().mockResolvedValue([]),
  markDuplicateFlag: vi.fn(),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() },
}));

function installCheckboxPolyfills() {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Object.defineProperty(globalThis, "ResizeObserver", {
    writable: true,
    value: ResizeObserverStub,
  });
}

function fillRequiredIdentity() {
  fireEvent.change(screen.getByLabelText(/Nombre completo/), {
    target: { value: "Ana Pérez" },
  });
  fireEvent.change(screen.getByLabelText(/Teléfono/), {
    target: { value: "3001234567" },
  });
  fireEvent.change(screen.getByLabelText(/Correo electrónico/), {
    target: { value: "ana@example.com" },
  });
  fireEvent.click(screen.getByLabelText(/He leído y acepto/));
}

describe("CaptureForm emergency contact card", () => {
  beforeEach(() => {
    installCheckboxPolyfills();
    vi.clearAllMocks();
    membersAddMock.mockResolvedValue(undefined);
    enqueueMock.mockResolvedValue(undefined);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("shows the emergency contact card in both variants", () => {
    const { unmount } = render(<CaptureForm submitAdapter={vi.fn()} />);
    expect(screen.getByText("Contacto de emergencia")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Nombre del contacto de emergencia"),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Parentesco")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Celular del contacto de emergencia"),
    ).toBeInTheDocument();
    unmount();
    render(<CaptureForm variant="retreat" submitAdapter={vi.fn()} />);
    expect(screen.getByText("Contacto de emergencia")).toBeInTheDocument();
  });

  it("blocks submit when a name is set without relationship or phone", async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined);
    render(<CaptureForm submitAdapter={submitAdapter} />);
    fillRequiredIdentity();
    fireEvent.change(
      screen.getByLabelText("Nombre del contacto de emergencia"),
      { target: { value: "Rosa Pérez" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar miembro" }),
    );
    expect(
      await screen.findByText(
        "Indique el parentesco del contacto de emergencia.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Indique el teléfono del contacto de emergencia."),
    ).toBeInTheDocument();
    expect(submitAdapter).not.toHaveBeenCalled();
  });

  it("submits the emergency contact fields via the adapter", async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined);
    render(<CaptureForm submitAdapter={submitAdapter} />);
    fillRequiredIdentity();
    fireEvent.change(
      screen.getByLabelText("Nombre del contacto de emergencia"),
      { target: { value: "Rosa Pérez" } },
    );
    fireEvent.change(screen.getByLabelText("Parentesco"), {
      target: { value: "madre" },
    });
    fireEvent.change(
      screen.getByLabelText("Celular del contacto de emergencia"),
      { target: { value: "3009998877" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar miembro" }),
    );
    await waitFor(() => expect(submitAdapter).toHaveBeenCalledTimes(1));
    expect(submitAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        emergencyContactName: "Rosa Pérez",
        emergencyContactRelationship: "madre",
        emergencyContactPhone: "3009998877",
      }),
    );
  });

  it("persists the emergency contact in the Dexie member path and the queue payload", async () => {
    render(<CaptureForm />);
    fillRequiredIdentity();
    fireEvent.change(
      screen.getByLabelText("Nombre del contacto de emergencia"),
      { target: { value: "Rosa Pérez" } },
    );
    fireEvent.change(screen.getByLabelText("Parentesco"), {
      target: { value: "madre" },
    });
    fireEvent.change(
      screen.getByLabelText("Celular del contacto de emergencia"),
      { target: { value: "3009998877" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Registrar miembro" }),
    );
    await waitFor(() => expect(membersAddMock).toHaveBeenCalledTimes(1));
    expect(membersAddMock).toHaveBeenCalledWith(
      expect.objectContaining({
        emergency_contact_name: "Rosa Pérez",
        emergency_contact_relationship: "madre",
        emergency_contact_phone: "3009998877",
      }),
    );
    expect(enqueueMock).toHaveBeenCalledWith(
      "members",
      expect.any(String),
      "insert",
      expect.objectContaining({
        emergency_contact_name: "Rosa Pérez",
        emergency_contact_relationship: "madre",
        emergency_contact_phone: "3009998877",
      }),
    );
  });
});
