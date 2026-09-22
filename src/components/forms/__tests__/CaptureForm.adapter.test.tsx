import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RETREAT_PRIVACY_NOTICE_ES } from "@/lib/consent/privacy-notice";
import { RETREAT_SUBMIT_LABEL } from "@/lib/retreat/constants";
import { CaptureForm } from "../CaptureForm";

const membersAddMock = vi.hoisted(() => vi.fn());
const enqueueMock = vi.hoisted(() => vi.fn());
const logGeneralConsentMock = vi.hoisted(() => vi.fn());
const logSensitiveConsentMock = vi.hoisted(() => vi.fn());
const findDuplicateMembersMock = vi.hoisted(() => vi.fn());
const markDuplicateFlagMock = vi.hoisted(() => vi.fn());
const rpcMock = vi.hoisted(() => vi.fn());
const getSessionMock = vi.hoisted(() => vi.fn());

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
  logGeneralConsent: logGeneralConsentMock,
  logSensitiveConsent: logSensitiveConsentMock,
  logConsentEvent: vi.fn(),
}));

vi.mock("@/lib/sync/conflict", () => ({
  findDuplicateMembers: findDuplicateMembersMock,
  markDuplicateFlag: markDuplicateFlagMock,
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getSession: getSessionMock },
    rpc: rpcMock,
  }),
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
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

describe("CaptureForm submit paths", () => {
  beforeEach(() => {
    installCheckboxPolyfills();
    vi.clearAllMocks();
    membersAddMock.mockResolvedValue(undefined);
    enqueueMock.mockResolvedValue(undefined);
    logGeneralConsentMock.mockResolvedValue(undefined);
    logSensitiveConsentMock.mockResolvedValue(undefined);
    findDuplicateMembersMock.mockResolvedValue([]);
    markDuplicateFlagMock.mockResolvedValue(undefined);
    getSessionMock.mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("uses Dexie and enqueue when no submitAdapter is provided", async () => {
    render(<CaptureForm />);
    fillRequiredIdentity();
    fireEvent.click(screen.getByRole("button", { name: "Registrar miembro" }));

    await waitFor(() => {
      expect(membersAddMock).toHaveBeenCalledTimes(1);
    });
    expect(enqueueMock).toHaveBeenCalledWith(
      "members",
      expect.any(String),
      "insert",
      expect.objectContaining({
        name: "Ana Pérez",
        phone: "3001234567",
        email: "ana@example.com",
      }),
    );
    expect(logGeneralConsentMock).toHaveBeenCalledTimes(1);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("calls submitAdapter after validation and skips Dexie, enqueue, and consent logging", async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined);
    render(<CaptureForm submitAdapter={submitAdapter} />);
    fillRequiredIdentity();
    fireEvent.click(screen.getByRole("button", { name: "Registrar miembro" }));

    await waitFor(() => {
      expect(submitAdapter).toHaveBeenCalledTimes(1);
    });
    expect(submitAdapter).toHaveBeenCalledWith({
      name: "Ana Pérez",
      phone: "3001234567",
      email: "ana@example.com",
      birthday: "",
      isMinor: false,
      legalRepName: "",
      generalConsent: true,
      sensitiveConsent: false,
      denomination: "",
      communityName: "",
      hasWhatsapp: false,
      additionalWhatsapp: "",
      hasMedicalConditions: false,
      medicalConditions: "",
      medicalMedications: "",
      medicalDosage: "",
    });
    expect(membersAddMock).not.toHaveBeenCalled();
    expect(enqueueMock).not.toHaveBeenCalled();
    expect(logGeneralConsentMock).not.toHaveBeenCalled();
    expect(logSensitiveConsentMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not call submitAdapter when client validation fails", async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined);
    render(<CaptureForm submitAdapter={submitAdapter} />);
    fireEvent.click(screen.getByLabelText(/He leído y acepto/));
    fireEvent.click(screen.getByRole("button", { name: "Registrar miembro" }));

    expect(screen.getByText("El nombre es obligatorio.")).toBeInTheDocument();
    expect(submitAdapter).not.toHaveBeenCalled();
    expect(membersAddMock).not.toHaveBeenCalled();
  });

  it("shows WhatsApp card but hides social card and uses retreat copy for variant=retreat", () => {
    render(<CaptureForm variant="retreat" submitAdapter={vi.fn()} />);

    expect(
      screen.getByRole("button", { name: RETREAT_SUBMIT_LABEL }),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Registrar miembro" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.queryByText("Redes sociales")).not.toBeInTheDocument();
    expect(screen.getByText(/PREINSCRIPCIÓN AL RETIRO JUVENIL/)).toBeVisible();
    expect(
      screen.getByText(/Contacto con el preinscrito o su representante legal/),
    ).toBeVisible();
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(
      /PREINSCRIPCIÓN AL RETIRO JUVENIL/,
    );
  });

  it("keeps member copy and optional contact cards for the default variant", () => {
    render(<CaptureForm />);

    expect(
      screen.getByRole("button", { name: "Registrar miembro" }),
    ).toBeVisible();
    expect(screen.getByText("WhatsApp")).toBeInTheDocument();
    expect(screen.getByText("Redes sociales")).toBeInTheDocument();
    expect(
      screen.getByText(/Registro de asistencia a actividades de la comunidad/),
    ).toBeInTheDocument();
  });
});

describe("CaptureForm medical section", () => {
  it("shows the medical card only for variant=retreat", () => {
    const { unmount } = render(
      <CaptureForm variant="retreat" submitAdapter={vi.fn()} />,
    );
    expect(screen.getByText("Condiciones médicas")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Tiene alguna condición médica"),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/¿Cuáles condiciones/),
    ).not.toBeInTheDocument();
    unmount();
    render(<CaptureForm submitAdapter={vi.fn()} />);
    expect(screen.queryByText("Condiciones médicas")).not.toBeInTheDocument();
  });

  it("requires conditions detail when the medical checkbox is checked", async () => {
    const submitAdapter = vi.fn().mockResolvedValue(undefined);
    render(<CaptureForm variant="retreat" submitAdapter={submitAdapter} />);
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
    fireEvent.click(screen.getByLabelText("Tiene alguna condición médica"));
    fireEvent.click(
      screen.getByRole("button", { name: "Preinscribirme al retiro" }),
    );
    expect(
      await screen.findByText("Indique las condiciones médicas."),
    ).toBeInTheDocument();
    expect(submitAdapter).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/¿Cuáles condiciones/), {
      target: { value: "Asma" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Preinscribirme al retiro" }),
    );
    await waitFor(() => expect(submitAdapter).toHaveBeenCalledTimes(1));
    expect(submitAdapter).toHaveBeenCalledWith(
      expect.objectContaining({
        hasMedicalConditions: true,
        medicalConditions: "Asma",
      }),
    );
  });
});

describe("CaptureForm user-facing submit errors", () => {
  it("shows the adapter message for userFacing errors instead of the generic toast", async () => {
    const { toast } = await import("sonner");
    const friendly = "Ya existe una preinscripción con ese email/teléfono para este retiro.";
    const submitAdapter = vi
      .fn()
      .mockRejectedValue(Object.assign(new Error(friendly), { userFacing: true }));
    render(<CaptureForm variant="retreat" submitAdapter={submitAdapter} />);
    fillRequiredIdentity();
    fireEvent.click(screen.getByRole("button", { name: RETREAT_SUBMIT_LABEL }));

    await waitFor(() => expect(submitAdapter).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(friendly),
    );
  });

  it("keeps the generic toast for non-userFacing errors", async () => {
    const { toast } = await import("sonner");
    const { RETREAT_ERROR_MESSAGE } = await import("@/lib/retreat/constants");
    const submitAdapter = vi.fn().mockRejectedValue(new Error("boom"));
    render(<CaptureForm variant="retreat" submitAdapter={submitAdapter} />);
    fillRequiredIdentity();
    fireEvent.click(screen.getByRole("button", { name: RETREAT_SUBMIT_LABEL }));

    await waitFor(() => expect(submitAdapter).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(RETREAT_ERROR_MESSAGE),
    );
  });
});
