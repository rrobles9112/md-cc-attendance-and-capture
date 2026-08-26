# WhatsApp Templates — Pastoreo (Utility, es_CO)

> Pastoral copy pending approval — do not submit to Meta Business Manager until the pastoral team signs off (T-104). Dev uses Twilio sandbox or Meta test number with sandbox templates (no approval needed).

## Submission checklist (Meta Business Manager)

1. Open **Business Manager > WhatsApp Manager > Message Templates**.
2. Create each template below with **Category: Utility**, **Language: es_CO**.
3. Use the variable samples so Meta can preview correctly.
4. Submit — utility review typically <1 hour. If rejected, revise copy and resubmit (no free-form fallback).
5. Dev: test with `dry_run=true` against Twilio sandbox or Meta test number before prod.

## Template T1 — absence_followup

- **Name:** `absence_followup`
- **Language:** `es_CO`
- **Category:** Utility
- **Recipient:** Absent member (per session)
- **Variables:**
  - `{{1}}` = member name (e.g. "Juan")
  - `{{2}}` = session name (e.g. "Sabado 23/08")
  - `{{3}}` = session_date formatted `DD/MM/YYYY` in `America/Bogota` (`toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })`)
- **Body (ES):**
  ```
  Hola {{1}}, te extrañamos ayer en {{2}} ({{3}}). ¿Cómo estás? Oramos por ti. Si necesitas algo, responde a este mensaje. 🙏
  ```
- **Body (EN reference):**
  ```
  Hi {{1}}, we missed you yesterday at {{2}} ({{3}}). How are you? We're praying for you. Reply if you need anything. 🙏
  ```
- **Graph API example:**
  ```json
  {
    "messaging_product": "whatsapp",
    "to": "+573001234567",
    "type": "template",
    "template": {
      "name": "absence_followup",
      "language": { "code": "es_CO" },
      "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "Juan" }, { "type": "text", "text": "Sabado 23/08" }, { "type": "text", "text": "23/08/2026" }] }]
    }
  }
  ```

## Template T2 — birthday_staff_digest

- **Name:** `birthday_staff_digest`
- **Language:** `es_CO`
- **Category:** Utility
- **Recipient:** Staff digest — one per staffer per day (super_admin + leader, `profiles.whatsapp_opt_in=true`, valid E.164, consent `whatsapp_messaging`)
- **Variables:**
  - `{{1}}` = comma-separated celebrants `"Ana (40), Luis (22)"` with `age_today = EXTRACT(YEAR FROM age(birthday))::int` on Bogota date
- **Body (ES):**
  ```
  🎂 Hoy cumplen años: {{1}}. ¡Oremos y celebremos con ellos!
  ```
- **Body (EN reference):**
  ```
  🎂 Birthdays today: {{1}}. Let's pray and celebrate!
  ```
- **Grouping helper:** `formatDigestGroup([{name, age}])` joins as `"Juan (35), Maria (40)"`
- **Graph API example:**
  ```json
  {
    "messaging_product": "whatsapp",
    "to": "+573001111111",
    "type": "template",
    "template": {
      "name": "birthday_staff_digest",
      "language": { "code": "es_CO" },
      "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "Ana (40), Luis (22)" }] }]
    }
  }
  ```

## Template T3 — shepherding_checkin

- **Name:** `shepherding_checkin`
- **Language:** `es_CO`
- **Category:** Utility
- **Recipient:** Chronic absentee (manual `Notify via WhatsApp` from Pastoreo — `leader`/`super_admin` JWT, per-row consent/phone/cap gate, `notification_log.created_by=auth.uid()`)
- **Variables:**
  - `{{1}}` = member name
  - `{{2}}` = community name (from `custom_params.community_name` or app_settings)
- **Body (ES):**
  ```
  Hola {{1}}, somos de {{2}}. Hace un tiempo no te vemos y queríamos saber cómo estás. ¿Podemos orar por algo?
  ```
- **Body (EN reference):**
  ```
  Hi {{1}}, we're from {{2}}. We haven't seen you in a while — how are you? Can we pray for something?
  ```
- **Graph API example:**
  ```json
  {
    "messaging_product": "whatsapp",
    "to": "+573001234567",
    "type": "template",
    "template": {
      "name": "shepherding_checkin",
      "language": { "code": "es_CO" },
      "components": [{ "type": "body", "parameters": [{ "type": "text", "text": "Juan" }, { "type": "text", "text": "Iglesia Central" }] }]
    }
  }
  ```

## Dev sandbox vs prod

- **Dev:** `WHATSAPP_PHONE_NUMBER_ID` may be Twilio sandbox or Meta test number — instant, no verification. Use `dry_run=true` to validate gates without provider calls.
- **Prod (D2 pending):** blocked until client delivers Business number / WABA (Business Manager + NIT verification 1–3 days). Injection is Vault + `app_settings.whatsapp_phone_number_id` + `supabase secrets set WHATSAPP_TOKEN=... WHATSAPP_PHONE_NUMBER_ID=...` + Edge redeploy — no migration. Edge fails closed with `failed` + banner "WhatsApp no configurado — D2 pending" when missing and `whatsapp_enabled=true`.
