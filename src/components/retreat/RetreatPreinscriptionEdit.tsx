"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";
import {
  applyRetreatRegistrationUpdate,
  type RetreatRegistrationUpdatePayload,
} from "@/lib/retreat/update";

export type RetreatRegistrationEditValues = {
  id: string;
  name: string;
  email: string;
  phone: string;
  birthday: string | null;
  legal_rep_name: string | null;
  has_whatsapp: boolean;
  whatsapp_number: string | null;
  has_medical_conditions: boolean;
  medical_conditions: string | null;
  medical_medications: string | null;
  medical_dosage: string | null;
  denomination: string | null;
  community_name: string | null;
};

export interface RetreatPreinscriptionEditProps {
  registration: RetreatRegistrationEditValues | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}

function toDateInputValue(value: string | null): string {
  if (!value) return "";
  return value.slice(0, 10);
}

export function RetreatPreinscriptionEdit({
  registration,
  open,
  onOpenChange,
  onSaved,
}: RetreatPreinscriptionEditProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [birthday, setBirthday] = useState("");
  const [legalRepName, setLegalRepName] = useState("");
  const [hasWhatsapp, setHasWhatsapp] = useState(false);
  const [whatsappNumber, setWhatsappNumber] = useState("");
  const [hasMedicalConditions, setHasMedicalConditions] = useState(false);
  const [medicalConditions, setMedicalConditions] = useState("");
  const [medicalMedications, setMedicalMedications] = useState("");
  const [medicalDosage, setMedicalDosage] = useState("");
  const [denomination, setDenomination] = useState("");
  const [communityName, setCommunityName] = useState("");
  const [sensitiveConsent, setSensitiveConsent] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!registration) return;
    setName(registration.name);
    setPhone(registration.phone);
    setEmail(registration.email);
    setBirthday(toDateInputValue(registration.birthday));
    setLegalRepName(registration.legal_rep_name ?? "");
    setHasWhatsapp(Boolean(registration.has_whatsapp));
    setWhatsappNumber(registration.whatsapp_number ?? "");
    setHasMedicalConditions(Boolean(registration.has_medical_conditions));
    setMedicalConditions(registration.medical_conditions ?? "");
    setMedicalMedications(registration.medical_medications ?? "");
    setMedicalDosage(registration.medical_dosage ?? "");
    setDenomination(registration.denomination ?? "");
    setCommunityName(registration.community_name ?? "");
    setSensitiveConsent(false);
  }, [registration]);

  async function handleSave() {
    if (!registration || saving) return;
    setSaving(true);
    try {
      const result = await applyRetreatRegistrationUpdate(
        {
          name,
          phone,
          email,
          birthday,
          legalRepName,
          hasWhatsapp,
          whatsappNumber,
          hasMedicalConditions,
          medicalConditions,
          medicalMedications,
          medicalDosage,
          denomination,
          communityName,
          sensitiveConsent,
          prevDenomination: registration.denomination,
          prevCommunityName: registration.community_name,
        },
        async (payload: RetreatRegistrationUpdatePayload) => {
          const supabase = createClient();
          const { data, error } = (await supabase
            .from("retreat_registrations")
            .update(payload)
            .eq("id", registration.id)
            .select("id")) as {
            data: Array<{ id: string }> | null;
            error: { message: string; code?: string } | null;
          };
          return { data, error };
        },
      );
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Preinscripción actualizada");
      onOpenChange(false);
      onSaved();
    } catch {
      toast.error("Error al actualizar la preinscripción");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar preinscripción</DialogTitle>
          <DialogDescription>
            Actualice los datos de contacto. El estado de pago no se
            modifica. Para guardar la denominación o la comunidad debe
            aceptar el consentimiento de datos sensibles (Ley 1581).
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSave();
          }}
        >
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-name">Nombre</Label>
            <Input
              id="retreat-edit-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              autoComplete="name"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-phone">Teléfono</Label>
            <Input
              id="retreat-edit-phone"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              autoComplete="tel"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-email">Email</Label>
            <Input
              id="retreat-edit-email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-birthday">Fecha de nacimiento</Label>
            <Input
              id="retreat-edit-birthday"
              type="date"
              value={birthday}
              onChange={(event) => setBirthday(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-legal-rep">Representante legal</Label>
            <Input
              id="retreat-edit-legal-rep"
              value={legalRepName}
              onChange={(event) => setLegalRepName(event.target.value)}
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="retreat-edit-has-whatsapp"
              checked={hasWhatsapp}
              onCheckedChange={(checked) => setHasWhatsapp(checked === true)}
            />
            <Label htmlFor="retreat-edit-has-whatsapp">Tiene WhatsApp</Label>
          </div>
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-whatsapp-number">
              Número de WhatsApp adicional
            </Label>
            <Input
              id="retreat-edit-whatsapp-number"
              value={whatsappNumber}
              onChange={(event) => setWhatsappNumber(event.target.value)}
              autoComplete="tel"
            />
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="retreat-edit-has-medical"
              checked={hasMedicalConditions}
              onCheckedChange={(checked) =>
                setHasMedicalConditions(checked === true)
              }
            />
            <Label htmlFor="retreat-edit-has-medical">
              Tiene alguna condición médica
            </Label>
          </div>
          {hasMedicalConditions && (
            <>
              <div className="space-y-1">
                <Label htmlFor="retreat-edit-medical-conditions">
                  ¿Cuáles condiciones?
                </Label>
                <Input
                  id="retreat-edit-medical-conditions"
                  value={medicalConditions}
                  onChange={(event) => setMedicalConditions(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="retreat-edit-medical-medications">
                  Medicamentos
                </Label>
                <Input
                  id="retreat-edit-medical-medications"
                  value={medicalMedications}
                  onChange={(event) =>
                    setMedicalMedications(event.target.value)
                  }
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="retreat-edit-medical-dosage">
                  Dosis / cada cuántas horas
                </Label>
                <Input
                  id="retreat-edit-medical-dosage"
                  value={medicalDosage}
                  onChange={(event) => setMedicalDosage(event.target.value)}
                />
              </div>
            </>
          )}
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-denomination">
              Denominación religiosa
            </Label>
            <Input
              id="retreat-edit-denomination"
              value={denomination}
              onChange={(event) => setDenomination(event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="retreat-edit-community">
              Nombre de la comunidad
            </Label>
            <Input
              id="retreat-edit-community"
              value={communityName}
              onChange={(event) => setCommunityName(event.target.value)}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="retreat-edit-sensitive-consent"
              checked={sensitiveConsent}
              onCheckedChange={(checked) =>
                setSensitiveConsent(checked === true)
              }
            />
            <Label htmlFor="retreat-edit-sensitive-consent">
              Acepto el tratamiento de mis datos religiosos (denominación y
              comunidad) según la Ley 1581
            </Label>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              Cancelar
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
