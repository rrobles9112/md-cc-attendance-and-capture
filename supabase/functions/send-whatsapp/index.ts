// @ts-nocheck
// supabase/functions/send-whatsapp/index.ts
// Deno Edge Function — single egress for WhatsApp Cloud API.
// Verify JWT / x-cron-secret, gates, idempotency, batch 50, provider call, notification_log.
// Deployed with: supabase functions deploy send-whatsapp --no-verify-jwt
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID, CRON_SECRET
//       (injected via `supabase secrets set` + Vault fallback)

// @ts-ignore Deno import
import { createClient } from "npm:@supabase/supabase-js@2";
import { parsePhoneNumberFromString } from "npm:libphonenumber-js@1.12.15";

// ---------------------------------------------------------------------------
// Helpers (mirrored from handler.ts for Deno portability — keep parity)
// ---------------------------------------------------------------------------
const E164_RE = /^\+[1-9]\d{7,14}$/;

function normalizeE164(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  try {
    const parsed = parsePhoneNumberFromString(trimmed, "CO");
    if (!parsed || !parsed.isValid()) return null;
    const e164 = parsed.format("E.164");
    if (!E164_RE.test(e164)) return null;
    return e164;
  } catch {
    return null;
  }
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

// ---------------------------------------------------------------------------
// Supabase helpers (service_role)
// ---------------------------------------------------------------------------
function getEnv(name: string): string | null {
  try {
    // @ts-ignore Deno global
    const v = Deno.env.get(name);
    return v ?? null;
  } catch {
    return null;
  }
}

function supabaseServiceClient() {
  const url = getEnv("SUPABASE_URL") ?? "";
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key, { auth: { persistSession: false } });
}

async function getAppSetting(supabase: ReturnType<typeof supabaseServiceClient>, key: string): Promise<string | null> {
  const { data } = await supabase.from("app_settings").select("value").eq("key", key).maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}

async function getWhatsappSecret(supabase: ReturnType<typeof supabaseServiceClient>, name: string): Promise<string | null> {
  // Prefer Deno env (supabase secrets) then Vault RPC fallback
  const envVal = getEnv(name);
  if (envVal) return envVal;
  try {
    const { data } = await supabase.rpc("get_whatsapp_secret", { p_name: name });
    return (data as string | null) ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "method_not_allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  // 1) Auth
  const authHeader = req.headers.get("authorization") ?? req.headers.get("Authorization") ?? "";
  const cronSecretHeader = req.headers.get("x-cron-secret") ?? req.headers.get("X-Cron-Secret") ?? "";

  if (!authHeader) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  const isServiceRole = authHeader.includes("service_role") || cronSecretHeader !== "";
  const supabase = supabaseServiceClient();

  if (isServiceRole) {
    const expectedCron = await getWhatsappSecret(supabase, "CRON_SECRET");
    // If expected is null/empty, allow (dev without Vault) but still require header presence
    if (expectedCron && !constantTimeEqual(cronSecretHeader, expectedCron)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
    if (!cronSecretHeader && expectedCron) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
  } else {
    // User JWT path — verify and enforce role for shepherding_checkin
    const token = authHeader.replace("Bearer ", "").trim();
    try {
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data.user) {
        return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json", ...corsHeaders() },
        });
      }
      // Check role via user_role() RPC or profiles query
      const { data: profile } = await supabase.from("profiles").select("role").eq("id", data.user.id).maybeSingle();
      const role = (profile as { role: string } | null)?.role ?? null;
      // body parsed later; we enforce after parsing but early deny if role is server/anon
      // Store role for later check
      (req as unknown as Record<string, unknown>).__role = role;
      (req as unknown as Record<string, unknown>).__userId = data.user.id;
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
  }

  // 2) Parse body
  let body: {
    kind?: string;
    session_id?: string;
    dry_run?: boolean;
    triggered_by?: string;
    member_ids?: string[];
    template_name?: string;
    custom_params?: Record<string, string>;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "invalid_json" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  const kind = body.kind;
  if (!kind || !["absence", "birthday", "shepherding_checkin"].includes(kind)) {
    return new Response(JSON.stringify({ ok: false, error: "invalid kind" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...corsHeaders() },
    });
  }

  // Manual shepherding_checkin requires leader/super_admin role
  if (!isServiceRole && kind === "shepherding_checkin") {
    const role = (req as unknown as Record<string, unknown>).__role as string | null;
    if (role !== "super_admin" && role !== "leader") {
      return new Response(JSON.stringify({ ok: false, error: "forbidden" }), {
        status: 403,
        headers: { "Content-Type": "application/json", ...corsHeaders() },
      });
    }
  }

  const templateNameMap: Record<string, string> = {
    absence: "absence_followup",
    birthday: "birthday_staff_digest",
    shepherding_checkin: "shepherding_checkin",
  };
  const templateName = body.template_name ?? templateNameMap[kind] ?? kind;
  const dryRun = Boolean(body.dry_run);

  // 3) Kill switch
  const whatsappEnabled = await getAppSetting(supabase, "whatsapp_enabled");
  const enabled = whatsappEnabled === null ? true : whatsappEnabled === "true";
  if (!enabled) {
    const res = {
      ok: true,
      kind,
      attempted: body.member_ids?.length ?? 0,
      sent: 0,
      skipped_no_consent: 0,
      skipped_invalid_phone: 0,
      skipped_duplicate: 0,
      skipped_cap: body.member_ids?.length ?? 0,
      failed: 0,
      errors: [{ member_id: "all", error: "whatsapp_disabled" }],
      provider: "meta_cloud_api",
      dry_run: dryRun,
    };
    return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  // 4) Missing credentials (D2 fail-closed)
  const whatsappToken = await getWhatsappSecret(supabase, "WHATSAPP_TOKEN");
  let phoneNumberId = await getWhatsappSecret(supabase, "WHATSAPP_PHONE_NUMBER_ID");
  if (!phoneNumberId) phoneNumberId = await getAppSetting(supabase, "whatsapp_phone_number_id");
  if (!whatsappToken || !phoneNumberId) {
    const attempted = body.member_ids?.length ?? 1;
    const res = {
      ok: true,
      kind,
      attempted,
      sent: 0,
      skipped_no_consent: 0,
      skipped_invalid_phone: 0,
      skipped_duplicate: 0,
      skipped_cap: 0,
      failed: attempted,
      errors: [{ member_id: "all", error: "missing whatsapp credentials — D2 pending" }],
      provider: "meta_cloud_api",
      dry_run: dryRun,
    };
    console.log(JSON.stringify({ kind, template_name: templateName, status: "failed", error: "missing whatsapp credentials — D2 pending" }));
    return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  // 5) Monthly cap
  const capStr = await getAppSetting(supabase, "whatsapp_monthly_cap");
  const cap = capStr ? parseInt(capStr, 10) : 900;
  // Count sent this month
  const { count: sentThisMonth } = await supabase
    .from("notification_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());

  if ((sentThisMonth ?? 0) >= cap) {
    const attempted = body.member_ids?.length ?? 0;
    const res = {
      ok: true,
      kind,
      sessions_processed: kind === "absence" ? 1 : undefined,
      attempted,
      sent: 0,
      skipped_no_consent: 0,
      skipped_invalid_phone: 0,
      skipped_duplicate: 0,
      skipped_cap: attempted,
      failed: 0,
      errors: [],
      provider: "meta_cloud_api",
      dry_run: dryRun,
    };
    return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
  }

  // 6) Build candidate list
  // For manual Pastoreo with member_ids, fetch members directly.
  // For cron absence/birthday, scan DB (simplified: use member_ids if provided, else query).
  type CandidateRow = {
    member_id: string;
    session_id: string | null;
    phoneRaw: string | null;
    whatsappOptIn: boolean;
    optOutAt: string | null;
    consentRows: { consent_type: string }[];
    notificationDate: string | null;
  };

  let candidates: CandidateRow[] = [];

  if (body.member_ids && body.member_ids.length > 0) {
    // Manual path — fetch members by ids
    const { data: members } = await supabase.from("members").select("id, phone, whatsapp_opt_in, whatsapp_opt_out_at").in("id", body.member_ids);
    const mRows = (members ?? []) as Array<{ id: string; phone: string | null; whatsapp_opt_in: boolean; whatsapp_opt_out_at: string | null }>;
    // Fetch consent for those members
    const { data: consents } = await supabase.from("consent_records").select("member_id, consent_type").in("member_id", body.member_ids).eq("consent_type", "whatsapp_messaging");
    const consentByMember = new Map<string, { consent_type: string }[]>();
    for (const c of (consents ?? []) as Array<{ member_id: string; consent_type: string }>) {
      const arr = consentByMember.get(c.member_id) ?? [];
      arr.push({ consent_type: c.consent_type });
      consentByMember.set(c.member_id, arr);
    }
    // Also try whatsapp_numbers fallback
    const { data: wn } = await supabase.from("whatsapp_numbers").select("member_id, number").in("member_id", body.member_ids).eq("is_primary_phone", true);
    const wnByMember = new Map<string, string>();
    for (const w of (wn ?? []) as Array<{ member_id: string; number: string }>) wnByMember.set(w.member_id, w.number);

    candidates = mRows.map((m) => ({
      member_id: m.id,
      session_id: body.session_id ?? null,
      phoneRaw: wnByMember.get(m.id) ?? m.phone,
      whatsappOptIn: m.whatsapp_opt_in,
      optOutAt: m.whatsapp_opt_out_at,
      consentRows: consentByMember.get(m.id) ?? [],
      notificationDate: kind === "birthday" ? new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) : null,
    }));
  } else {
    // Cron path
    if (kind === "absence") {
      // Find yesterday sessions (Bogota)
      const yesterdayBogota = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      // Compute yesterday: subtract 1 day from Bogota date
      const bogotaNow = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Bogota" }));
      bogotaNow.setDate(bogotaNow.getDate() - 1);
      const yStr = bogotaNow.toISOString().slice(0, 10);

      let sessionIds: string[] = [];
      if (body.session_id) sessionIds = [body.session_id];
      else {
        const { data: sessions } = await supabase.from("sessions").select("id").eq("session_date", yStr).is("deleted_at", null);
        sessionIds = ((sessions ?? []) as Array<{ id: string }>).map((s) => s.id);
      }

      if (sessionIds.length === 0) {
        const res = {
          ok: true,
          kind,
          sessions_processed: 0,
          attempted: 0,
          sent: 0,
          skipped_no_consent: 0,
          skipped_invalid_phone: 0,
          skipped_duplicate: 0,
          skipped_cap: 0,
          failed: 0,
          errors: [],
          provider: "meta_cloud_api",
          dry_run: dryRun,
        };
        return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
      }

      // For each session, find absentees via anti-join (simplified: all active members not attending)
      const { data: members } = await supabase.from("members").select("id, phone, whatsapp_opt_in, whatsapp_opt_out_at").is("deleted_at", null).limit(1000);
      const allMembers = (members ?? []) as Array<{ id: string; phone: string | null; whatsapp_opt_in: boolean; whatsapp_opt_out_at: string | null }>;
      // Fetch attendance for those sessions
      const { data: att } = await supabase.from("attendance").select("member_id, session_id").in("session_id", sessionIds).is("deleted_at", null);
      const attSet = new Set(((att ?? []) as Array<{ member_id: string; session_id: string }>).map((a) => `${a.session_id}:${a.member_id}`));
      // Fetch consents bulk
      const memberIds = allMembers.map((m) => m.id);
      const { data: consents } = await supabase.from("consent_records").select("member_id, consent_type").in("member_id", memberIds).eq("consent_type", "whatsapp_messaging");
      const consentByMember = new Map<string, { consent_type: string }[]>();
      for (const c of (consents ?? []) as Array<{ member_id: string; consent_type: string }>) {
        const arr = consentByMember.get(c.member_id) ?? [];
        arr.push({ consent_type: c.consent_type });
        consentByMember.set(c.member_id, arr);
      }

      for (const sid of sessionIds) {
        for (const m of allMembers) {
          if (attSet.has(`${sid}:${m.id}`)) continue;
          candidates.push({
            member_id: m.id,
            session_id: sid,
            phoneRaw: m.phone,
            whatsappOptIn: m.whatsapp_opt_in,
            optOutAt: m.whatsapp_opt_out_at,
            consentRows: consentByMember.get(m.id) ?? [],
            notificationDate: null,
          });
        }
      }
      if (sessionIds.length === 0) {
        // already returned
      }
    } else if (kind === "birthday") {
      const bogotaDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      const [y, mo, da] = bogotaDateStr.split("-").map(Number);
      // Fetch members with birthday not null (simplified; Feb29 handling via is_leap_year)
      const isLeap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const { data: members } = await supabase.from("members").select("id, name, birthday").is("deleted_at", null).not("birthday", "is", null).limit(1000);
      const birthdayMembers = ((members ?? []) as Array<{ id: string; name: string; birthday: string }>).filter((m) => {
        const d = new Date(m.birthday);
        const mm = d.getUTCMonth() + 1;
        const dd = d.getUTCDate();
        if (mm === mo && dd === da) return true;
        if (mm === 2 && dd === 29 && !isLeap && mo === 2 && da === 28) return true;
        return false;
      });

      if (birthdayMembers.length === 0) {
        // Log skipped_no_birthdays
        await supabase.from("notification_log").insert({
          kind: "birthday",
          template_name: templateName,
          status: "skipped_no_birthdays",
          notification_date: bogotaDateStr,
          channel: "whatsapp",
        } as never);
        const res = {
          ok: true,
          kind,
          attempted: 0,
          sent: 0,
          skipped_no_consent: 0,
          skipped_invalid_phone: 0,
          skipped_duplicate: 0,
          skipped_cap: 0,
          skipped_no_birthdays: 1,
          failed: 0,
          errors: [],
          provider: "meta_cloud_api",
          dry_run: dryRun,
        };
        return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
      }

      // Resolve staff recipients (super_admin + leader with opt_in)
      const { data: staff } = await supabase.from("profiles").select("id, whatsapp_number, whatsapp_opt_in").in("role", ["super_admin", "leader"]).eq("whatsapp_opt_in", true);
      const staffRows = (staff ?? []) as Array<{ id: string; whatsapp_number: string | null; whatsapp_opt_in: boolean }>;
      // Filter staff with valid phone and consent
      const { data: staffConsents } = await supabase
        .from("consent_records")
        .select("member_id, consent_type")
        .eq("consent_type", "whatsapp_messaging");
      const consentSet = new Set(((staffConsents ?? []) as Array<{ member_id: string }>).map((c) => c.member_id));
      // For simplicity, require consentRows for each staff recipient; we will handle per-recipient in loop
      // Build candidates per celebrant per staff recipient
      for (const celebrant of birthdayMembers) {
        for (const s of staffRows) {
          const phone = s.whatsapp_number;
          const hasConsent = consentSet.has(s.id);
          candidates.push({
            member_id: celebrant.id,
            session_id: null,
            phoneRaw: phone,
            whatsappOptIn: s.whatsapp_opt_in && hasConsent,
            optOutAt: null,
            consentRows: hasConsent ? [{ consent_type: "whatsapp_messaging" }] : [],
            notificationDate: bogotaDateStr,
          });
          // Store recipient for dedup key usage — encode via member_id mapping trick
          // We append recipient id via a separate map looked up during processing
          // For Edge simplicity, we treat phoneRaw as staff phone and member_id as celebrant
        }
      }
      if (candidates.length === 0) {
        await supabase.from("notification_log").insert({
          kind: "birthday",
          template_name: templateName,
          status: "skipped_no_recipients",
          notification_date: bogotaDateStr,
          channel: "whatsapp",
        } as never);
        const res = {
          ok: true,
          kind,
          attempted: 0,
          sent: 0,
          skipped_no_consent: 0,
          skipped_invalid_phone: 0,
          skipped_duplicate: 0,
          skipped_cap: 0,
          skipped_no_recipients: 1,
          failed: 0,
          errors: [],
          provider: "meta_cloud_api",
          dry_run: dryRun,
        };
        return new Response(JSON.stringify(res), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
      }
    }
  }

  // 7) Process candidates: gates + idempotency + batching + provider
  const createdBy = (req as unknown as Record<string, unknown>).__userId as string | undefined;

  // Fetch existing dedup keys to avoid extra per-candidate queries (bulk)
  // For absence: (session_id, member_id, kind) where status in sent/queued
  // For birthday: (member_id, kind, notification_date)
  let existingKeys: Record<string, string>[] = [];
  try {
    if (kind === "birthday") {
      const bogotaDateStr = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      const { data } = await supabase
        .from("notification_log")
        .select("member_id, recipient_profile_id, kind, notification_date")
        .eq("kind", "birthday")
        .eq("notification_date", bogotaDateStr)
        .in("status", ["sent", "queued"]);
      existingKeys = ((data ?? []) as Array<Record<string, string>>).map((r) => ({
        member_id: String(r.member_id ?? ""),
        recipient_profile_id: String((r as Record<string, unknown>).recipient_profile_id ?? ""),
        kind: String(r.kind ?? ""),
        notification_date: String(r.notification_date ?? ""),
      }));
    } else {
      const { data } = await supabase
        .from("notification_log")
        .select("session_id, member_id, kind")
        .eq("kind", kind)
        .in("status", ["sent", "queued"]);
      existingKeys = ((data ?? []) as Array<Record<string, string>>).map((r) => ({
        session_id: String(r.session_id ?? ""),
        member_id: String(r.member_id ?? ""),
        kind: String(r.kind ?? ""),
      }));
    }
  } catch {
    existingKeys = [];
  }

  const counts = {
    attempted: candidates.length,
    sent: 0,
    skipped_no_consent: 0,
    skipped_invalid_phone: 0,
    skipped_duplicate: 0,
    skipped_cap: 0,
    failed: 0,
    errors: [] as Array<{ member_id: string; error: string }>,
  };

  const chunks: CandidateRow[][] = [];
  for (let i = 0; i < candidates.length; i += 50) chunks.push(candidates.slice(i, i + 50));

  for (const chunk of chunks) {
    for (const c of chunk) {
      // Consent triple gate
      const hasConsent = c.consentRows.some((r) => r.consent_type === "whatsapp_messaging");
      if (!c.whatsappOptIn || c.optOutAt != null || !hasConsent) {
        counts.skipped_no_consent += 1;
        await supabase.from("notification_log").insert({
          member_id: c.member_id,
          session_id: c.session_id,
          kind,
          template_name: templateName,
          status: "skipped_no_consent",
          notification_date: c.notificationDate,
          created_by: createdBy ?? null,
          channel: "whatsapp",
        } as never);
        continue;
      }

      const e164 = normalizeE164(c.phoneRaw);
      if (!e164) {
        counts.skipped_invalid_phone += 1;
        await supabase.from("notification_log").insert({
          member_id: c.member_id,
          session_id: c.session_id,
          kind,
          template_name: templateName,
          status: "skipped_invalid_phone",
          error: `invalid phone: ${c.phoneRaw}`,
          notification_date: c.notificationDate,
          created_by: createdBy ?? null,
          channel: "whatsapp",
        } as never);
        continue;
      }

      // Idempotency
      const dedupKey =
        kind === "birthday" && c.notificationDate
          ? { member_id: c.member_id, kind, notification_date: c.notificationDate }
          : c.session_id
            ? { session_id: c.session_id, member_id: c.member_id, kind }
            : { member_id: c.member_id, kind };
      const isDup = existingKeys.some((row) => Object.entries(dedupKey).every(([k, v]) => String(row[k] ?? "") === String(v)));
      if (isDup) {
        counts.skipped_duplicate += 1;
        continue;
      }

      if (dryRun) {
        counts.sent += 1;
        continue;
      }

      const started = Date.now();
      try {
        const res = await fetch(`https://graph.facebook.com/v20.0/${phoneNumberId}/messages`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            messaging_product: "whatsapp",
            to: e164,
            type: "template",
            template: {
              name: templateName,
              language: { code: "es_CO" },
              components: [
                {
                  type: "body",
                  parameters: [
                    { type: "text", text: c.member_id },
                    { type: "text", text: kind },
                    { type: "text", text: c.notificationDate ?? new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota" }) },
                  ],
                },
              ],
            },
          }),
        });

        const latency_ms = Date.now() - started;
        if (!res.ok) {
          const bodyText = await res.text().catch(() => "");
          counts.failed += 1;
          counts.errors.push({ member_id: c.member_id, error: bodyText || `provider ${res.status}` });
          await supabase.from("notification_log").insert({
            member_id: c.member_id,
            session_id: c.session_id,
            kind,
            template_name: templateName,
            status: "failed",
            error: bodyText,
            notification_date: c.notificationDate,
            created_by: createdBy ?? null,
            channel: "whatsapp",
          } as never);
          console.log(JSON.stringify({ kind, member_id: c.member_id, session_id: c.session_id, template_name: templateName, status: "failed", latency_ms, error: bodyText }));
          continue;
        }

        const data = (await res.json().catch(() => ({}))) as { messages?: Array<{ id: string }> };
        const providerId = data.messages?.[0]?.id ?? null;
        counts.sent += 1;
        await supabase.from("notification_log").insert({
          member_id: c.member_id,
          session_id: c.session_id,
          kind,
          template_name: templateName,
          status: "sent",
          provider_message_id: providerId,
          sent_at: new Date().toISOString(),
          notification_date: c.notificationDate,
          created_by: createdBy ?? null,
          channel: "whatsapp",
        } as never);
        console.log(
          JSON.stringify({
            kind,
            member_id: c.member_id,
            session_id: c.session_id,
            template_name: templateName,
            status: "sent",
            provider_message_id: providerId,
            latency_ms,
          }),
        );
        existingKeys.push(Object.fromEntries(Object.entries(dedupKey).map(([k, v]) => [k, String(v)])));
      } catch (err) {
        const latency_ms = Date.now() - started;
        const msg = err instanceof Error ? err.message : String(err);
        counts.failed += 1;
        counts.errors.push({ member_id: c.member_id, error: msg });
        await supabase.from("notification_log").insert({
          member_id: c.member_id,
          session_id: c.session_id,
          kind,
          template_name: templateName,
          status: "failed",
          error: msg,
          notification_date: c.notificationDate,
          created_by: createdBy ?? null,
          channel: "whatsapp",
        } as never);
        console.log(JSON.stringify({ kind, member_id: c.member_id, template_name: templateName, status: "failed", latency_ms, error: msg }));
      }
    }
  }

  const result = {
    ok: true,
    kind,
    sessions_processed: kind === "absence" ? (body.session_id ? 1 : 1) : undefined,
    attempted: counts.attempted,
    sent: counts.sent,
    skipped_no_consent: counts.skipped_no_consent,
    skipped_invalid_phone: counts.skipped_invalid_phone,
    skipped_duplicate: counts.skipped_duplicate,
    skipped_cap: counts.skipped_cap,
    failed: counts.failed,
    errors: counts.errors,
    provider: "meta_cloud_api",
    dry_run: dryRun,
  };

  return new Response(JSON.stringify(result), { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders() } });
});
