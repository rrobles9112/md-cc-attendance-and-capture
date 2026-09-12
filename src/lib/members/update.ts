import { checkMinorStatus, validateMinorFields } from "@/lib/consent/validation";

export type MemberUpdateInput = {
  name: string;
  phone: string;
  email: string;
  birthday: string;
  legalRepName: string;
  hasWhatsapp: boolean;
};

export type MemberUpdatePayload = {
  name: string;
  name_normalized: string;
  phone: string;
  email: string;
  birthday: string | null;
  is_minor: boolean;
  legal_rep_name: string | null;
  has_whatsapp: boolean;
  updated_at: string;
};

export type MemberUpdateResult =
  | { ok: true; payload: MemberUpdatePayload }
  | { ok: false; error: string };

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function buildMemberUpdate(input: MemberUpdateInput): MemberUpdateResult {
  const name = input.name.trim();
  const phone = input.phone.trim();
  const email = input.email.trim().toLowerCase();

  if (!name) {
    return { ok: false, error: "El nombre es obligatorio" };
  }
  if (!phone) {
    return { ok: false, error: "El teléfono es obligatorio" };
  }
  if (!email) {
    return { ok: false, error: "El correo es obligatorio" };
  }

  const birthday = input.birthday.trim();
  const isMinor = birthday ? checkMinorStatus(new Date(birthday)).isMinor : false;
  const legalRep = input.legalRepName.trim();
  const minorCheck = validateMinorFields(isMinor, legalRep);
  if (!minorCheck.valid) {
    return { ok: false, error: minorCheck.error ?? "El representante legal es obligatorio" };
  }

  return {
    ok: true,
    payload: {
      name,
      name_normalized: normalizeName(name),
      phone,
      email,
      birthday: birthday || null,
      is_minor: isMinor,
      legal_rep_name: isMinor ? legalRep : null,
      has_whatsapp: input.hasWhatsapp,
      updated_at: new Date().toISOString(),
    },
  };
}
