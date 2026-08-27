"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import {
  db,
  type Member,
  type SocialMedia,
  type WhatsAppNumber,
} from "@/lib/sync/db";
import { useRealtime } from "@/hooks/useRealtime";
import { useCacheHydration } from "@/hooks/useCacheHydration";
import { useRole } from "@/hooks/useRole";
import { canDelete, canManageRetreatRegistrations } from "@/lib/rbac/guards";
import { softDelete } from "@/lib/delete/soft-delete";
import { enqueue } from "@/lib/sync/queue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Trash2, Eye } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getBirthdaysOfMonth, getNewMembers } from "@/lib/members/highlights";
import { CaptureForm, type CaptureFormInitialValues } from "@/components/forms/CaptureForm";
import { submitRetreatPreinscriptionForMember } from "@/lib/retreat/submit-adapter";
import { RETREAT_EVENT_KEY } from "@/lib/retreat/constants";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";

function memberToInitialValues(member: Member): CaptureFormInitialValues {
  return {
    name: member.name,
    phone: member.phone,
    email: member.email,
    birthday: member.birthday ?? "",
    isMinor: member.is_minor,
    legalRepName: member.legal_rep_name ?? "",
  };
}

export default function MembersPage() {
  const { role } = useRole();
  const router = useRouter();
  const [members, setMembers] = useState<Member[]>([]);
  const [search, setSearch] = useState("");
  const [selectedMember, setSelectedMember] = useState<Member | null>(null);
  const [socialMedia, setSocialMedia] = useState<SocialMedia[]>([]);
  const [whatsappNumbers, setWhatsappNumbers] = useState<WhatsAppNumber[]>([]);
  const [retreatDialogOpen, setRetreatDialogOpen] = useState(false);
  const [retreatBadge, setRetreatBadge] = useState<boolean | null>(null);
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [hasSession, setHasSession] = useState(false);

  const loadMembers = useCallback(async () => {
    const allMembers = await db.members
      .filter((m) => m.deleted_at === null)
      .toArray();
    setMembers(allMembers.sort((a, b) => a.name.localeCompare(b.name)));
  }, []);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  useCacheHydration(() => {
    void loadMembers();
  });

  useRealtime({
    table: "members",
    onInsert: () => loadMembers(),
    onUpdate: () => loadMembers(),
    onDelete: () => loadMembers(),
  });

  useEffect(() => {
    function handleOnline() {
      setIsOnline(navigator.onLine);
    }
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOnline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOnline);
    };
  }, []);

  useEffect(() => {
    const supabase = createClient();
    supabase.auth.getSession().then(({ data: { session } }) => {
      setHasSession(!!session);
    });
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setHasSession(!!session);
    });
    return () => subscription.unsubscribe();
  }, []);

  const refreshBadge = useCallback(async (memberId: string) => {
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("retreat_registrations")
        .select("id")
        .eq("member_id", memberId)
        .eq("event_key", RETREAT_EVENT_KEY)
        .maybeSingle();
      setRetreatBadge(data !== null);
    } catch {
      setRetreatBadge(null);
    }
  }, []);

  useEffect(() => {
    if (selectedMember) {
      setRetreatBadge(null);
      void refreshBadge(selectedMember.id);
    } else {
      setRetreatBadge(null);
    }
  }, [selectedMember, refreshBadge]);

  async function handleViewMember(member: Member) {
    setSelectedMember(member);
    const sm = await db.social_media
      .where("member_id")
      .equals(member.id)
      .toArray();
    const wa = await db.whatsapp_numbers
      .where("member_id")
      .equals(member.id)
      .toArray();
    setSocialMedia(sm);
    setWhatsappNumbers(wa);
  }

  async function handleDeleteMember(member: Member) {
    if (!role || !canDelete(role)) return;
    if (!confirm(`¿Está seguro de eliminar a ${member.name}?`)) return;

    try {
      await softDelete("members", member.id);
      await enqueue("members", member.id, "update", {
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
      toast.success("Miembro eliminado");
      setSelectedMember(null);
      await loadMembers();
    } catch {
      toast.error("Error al eliminar el miembro");
    }
  }

  const filteredMembers = members.filter(
    (m) =>
      m.name.toLowerCase().includes(search.toLowerCase()) ||
      m.phone.includes(search) ||
      m.email.toLowerCase().includes(search.toLowerCase()),
  );

  const birthdaysOfMonth = useMemo(
    () => getBirthdaysOfMonth(members),
    [members],
  );
  const newMembers = useMemo(() => getNewMembers(members), [members]);

  const canShowPreinscribe =
    role !== null &&
    canManageRetreatRegistrations(role) &&
    selectedMember !== null &&
    selectedMember.deleted_at === null &&
    isOnline &&
    hasSession;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Miembros</h1>
        <p className="text-muted-foreground">
          Gestiona el directorio y consulta los destacados en vistas
          separadas
        </p>
      </div>

      <Tabs defaultValue="directory" className="space-y-4">
        <TabsList>
          <TabsTrigger value="directory">
            Directorio
            <Badge variant="secondary" className="ml-2">
              {filteredMembers.length}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="highlights">
            Destacados
            <Badge variant="secondary" className="ml-2">
              {birthdaysOfMonth.length + newMembers.length}
            </Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="directory" className="space-y-4">
          <div className="flex items-center gap-3">
            <Input
              placeholder="Buscar por nombre, teléfono o correo..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="max-w-sm"
            />
            <Badge variant="outline">{filteredMembers.length} miembros</Badge>
          </div>

          <div className="rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nombre</TableHead>
              <TableHead className="hidden sm:table-cell">Teléfono</TableHead>
              <TableHead className="hidden md:table-cell">Email</TableHead>
              <TableHead className="hidden lg:table-cell">WhatsApp</TableHead>
              <TableHead className="w-24">Acciones</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredMembers.length === 0 ? (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  {search
                    ? "No se encontraron miembros"
                    : "No hay miembros registrados"}
                </TableCell>
              </TableRow>
            ) : (
              filteredMembers.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{member.name}</span>
                      {member.duplicate_flag && (
                        <Badge variant="destructive" className="text-[10px]">
                          Duplicado
                        </Badge>
                      )}
                      {member.is_minor && (
                        <Badge
                          variant="outline"
                          className="text-[10px] bg-amber-50 text-amber-800"
                        >
                          Menor
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {member.phone}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {member.email}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {member.has_whatsapp ? (
                      <Badge
                        variant="outline"
                        className="bg-green-50 text-green-800"
                      >
                        Sí
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">No</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleViewMember(member)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      {role && canDelete(role) && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteMember(member)}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
        </TabsContent>

        <TabsContent value="highlights" className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  🎂 Cumpleaños del mes
                  <Badge variant="outline">{birthdaysOfMonth.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Miembros que cumplen años este mes
                </CardDescription>
              </CardHeader>
              <CardContent>
                {birthdaysOfMonth.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin cumpleaños este mes
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {birthdaysOfMonth.map((highlight) => (
                      <li key={highlight.id}>
                        <span className="font-medium">{highlight.day}</span>
                        {" — "}
                        {highlight.name}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between">
                  ✨ Nuevos inscritos
                  <Badge variant="outline">{newMembers.length}</Badge>
                </CardTitle>
                <CardDescription>
                  Inscripciones de los últimos 30 días
                </CardDescription>
              </CardHeader>
              <CardContent>
                {newMembers.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin inscripciones en los últimos 30 días
                  </p>
                ) : (
                  <ul className="space-y-1 text-sm">
                    {newMembers.map((highlight) => (
                      <li key={highlight.id}>
                        <span className="font-medium">{highlight.name}</span>
                        {" — "}
                        {new Date(highlight.date).toLocaleDateString("es-CO")}
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!selectedMember}
        onOpenChange={(open) => !open && setSelectedMember(null)}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {selectedMember?.name}
              {retreatBadge && (
                <Badge variant="outline" className="bg-emerald-50 text-emerald-800">
                  Preinscrito
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>Detalle del miembro</DialogDescription>
          </DialogHeader>
          {selectedMember && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Teléfono:</span>
                  <p className="font-medium">{selectedMember.phone}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Email:</span>
                  <p className="font-medium">{selectedMember.email}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Fecha de nacimiento:
                  </span>
                  <p className="font-medium">
                    {selectedMember.birthday ?? "No registrada"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">WhatsApp:</span>
                  <p className="font-medium">
                    {selectedMember.has_whatsapp ? "Sí" : "No"}
                  </p>
                </div>
                {selectedMember.is_minor && (
                  <div className="col-span-2">
                    <span className="text-muted-foreground">
                      Representante legal:
                    </span>
                    <p className="font-medium">
                      {selectedMember.legal_rep_name}
                    </p>
                  </div>
                )}
                <div>
                  <span className="text-muted-foreground">Consentimiento:</span>
                  <p className="font-medium">
                    {selectedMember.consent_recorded ? "Sí" : "No"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">
                    Datos sensibles:
                  </span>
                  <p className="font-medium">
                    {selectedMember.sensitive_consent_recorded ? "Sí" : "No"}
                  </p>
                </div>
              </div>

              {whatsappNumbers.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">
                    Números de WhatsApp adicionales
                  </h4>
                  {whatsappNumbers.map((wa) => (
                    <Badge key={wa.id} variant="outline">
                      {wa.number}
                    </Badge>
                  ))}
                </div>
              )}

              {socialMedia.length > 0 && (
                <div>
                  <h4 className="mb-2 text-sm font-medium">Redes sociales</h4>
                  <div className="flex flex-wrap gap-2">
                    {socialMedia.map((sm) => (
                      <Badge key={sm.id} variant="outline">
                        {sm.platform}: {sm.handle}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Registrado:{" "}
                {new Date(selectedMember.created_at).toLocaleDateString(
                  "es-CO",
                )}
              </div>

              {canShowPreinscribe ? (
                <Button
                  onClick={() => setRetreatDialogOpen(true)}
                  disabled={!isOnline || !hasSession}
                  title={!isOnline ? "Requiere conexión" : undefined}
                >
                  Preinscribir al retiro
                </Button>
              ) : (
                role !== null &&
                canManageRetreatRegistrations(role) &&
                selectedMember.deleted_at === null && (
                  <Button
                    disabled
                    title={!isOnline ? "Requiere conexión" : !hasSession ? "Requiere sesión" : undefined}
                  >
                    Preinscribir al retiro
                  </Button>
                )
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={retreatDialogOpen} onOpenChange={setRetreatDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Preinscribir a {selectedMember?.name} al retiro</DialogTitle>
            <DialogDescription>
              Los datos se precargan del miembro y son editables. Se requiere consentimiento fresco (Ley 1581).
            </DialogDescription>
          </DialogHeader>
          {selectedMember && (
            <CaptureForm
              variant="retreat"
              initialValues={memberToInitialValues(selectedMember)}
              submitAdapter={async (payload) => {
                try {
                  await submitRetreatPreinscriptionForMember(selectedMember.id, payload);
                } catch (e: unknown) {
                  const msg = e instanceof Error ? e.message : String(e);
                  const code = (e as { code?: string })?.code;
                  if (msg.includes("already_preinscribed") || code === "23505") {
                    toast.error("Ya existe una preinscripción con ese email/teléfono para este retiro.", {
                      action: {
                        label: "Ver en Retiro",
                        onClick: () => router.push("/retreat-registrations"),
                      },
                    });
                    throw e;
                  }
                  if (msg.includes("not_authorized") || code === "42501") {
                    toast.error("No tiene permisos para preinscribir al retiro.");
                    throw e;
                  }
                  if (msg.includes("missing_consent") || msg.includes("general consent is required")) {
                    toast.error("Debe aceptar el aviso de privacidad para continuar.");
                    throw e;
                  }
                  throw e;
                }
              }}
              onSuccess={() => {
                toast.success("Preinscripción creada", {
                  action: {
                    label: "Ver en Retiro",
                    onClick: () => router.push("/retreat-registrations"),
                  },
                });
                setRetreatDialogOpen(false);
                void refreshBadge(selectedMember.id);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
