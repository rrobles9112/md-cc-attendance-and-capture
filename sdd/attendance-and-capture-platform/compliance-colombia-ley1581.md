# Compliance Research: Colombian Personal Data Protection (Ley 1581 de 2012)

> Research input for the SDD spec phase. Linked from `proposal.md` (Resolved Decisions #6).
> Sources cited at the bottom; claims verified against first-party/legal summaries on 2026-07-16.

## Legal framework

- **Constitutional basis**: Article 15 of the 1991 Constitution — Habeas Data is a *fundamental* right (privacy + right to know/update/rectify data in public/private databases). Because it is constitutional, it is regulated by Statutory Law, making the framework unusually stable.
- **Law 1581 of 2012**: General Data Protection Law — the primary compliance instrument.
- **Decree 1377 of 2013**: operational details (consent, privacy policy, data-subject rights procedures).
- **Decree 1074 of 2015**: Single Regulatory Decree compiling commerce/data-protection provisions.
- **Authority**: **SIC** (Superintendencia de Industria y Comercio) — Delegation for the Protection of Personal Data. Broad investigative and sanctioning powers; conducts inspections and issues binding circulars (e.g., Circular 002 of 2024 for AI, Circular 001 of 2025 for Fintech/biometrics).

## Data categories (matters for the capture form)

| Category | Definition | Rule |
|---|---|---|
| Public | Public records, court rulings, civil status | No authorization needed, but Habeas Data principles still apply |
| Semi-private | Sector interest (financial/credit/commercial) | Regulated mainly by Law 1266/2008 |
| Private | Intimate nature (personal phone, home address, private photos) | Requires **prior, express, informed** consent |
| **Sensitive** | Affects intimacy or whose misuse can cause discrimination — **biometrics, health, sexual life, religious/political views** | Processing **generally prohibited** except specific exceptions; owner **not obliged** to authorize; must be **explicitly informed** of that right |

### Impact on THIS app
- **Contact (name, phone, email)** → private data → prior/express/informed consent required.
- **Birthday (date of birth)** → private data → consent required. If the person is a **minor (<18)**, special constitutional protection applies: processing only when in the minor's prevalent interest AND authorized by a legal representative; the minor's opinion must be sought per their maturity.
- **WhatsApp number, social media** → private data → consent required.
- **Religious background (denomination, community name)** → **SENSITIVE data** (religious views). This is the critical compliance constraint:
  - Separate, explicit opt-in — NOT bundled with the general consent.
  - Must display a notice that the person is **not obliged** to provide it and that refusing has no negative consequence.
  - Extra security measures (encryption at rest for these fields).
  - Field must be optional and clearly marked sensitive.

## Consent standard (Principle of Freedom)

Consent must be **prior, express, and informed**:
- **Prior**: obtained before any collection/processing.
- **Express**: written/oral statement or unequivocal conduct. **Silence and pre-checked boxes do NOT count.**
- **Informed**: tells the person the purpose, their rights, the controller's identity, and (for sensitive data) that they are not required to provide it.

The controller must keep **proof of authorization** and produce consent records on SIC demand. → Our existing `audit_log` (Postgres triggers) should also capture consent events (timestamp, version of policy shown, explicit acceptance).

## Data-subject rights (ARCO)

| Right | Description | Response deadline |
|---|---|---|
| Knowledge & Access | Know whether data about them exists | 10 business days (max +5 ext.) |
| Update & Rectification | Correct incomplete/erroneous data | 15 business days (max +8 ext.) |
| Revocation & Suppression | Withdraw authorization / demand deletion (esp. if law violated or purpose fulfilled) | 15 business days |
| Opposition | Object to specific processing | 15 business days |
| Proof of Authorization | Request a copy of the original consent | — |

A formal SIC complaint can only be filed **after** the subject first tries to resolve with the controller. → v1 needs a DSAR/ARCO request workflow and a designated contact (DPO strongly recommended by SIC).

## Transparency requirements

- **Personal Data Treatment Policy (PDTP)**: must exist and include controller ID + contact, purposes, data-subject rights, claims handler, ARCO procedure, effective date, database duration.
- **Privacy Notice**: at every collection point (e.g., the capture form), in **Spanish**, informing of the PDTP's existence and how to access it. For the capture form, must differentiate "necessary" purposes (running the prayer group / attendance) from "ancillary" purposes (birthday campaigns, marketing).

## Cross-border transfers (Art. 26)

- Transfers to countries without an "adequate level" of protection are **generally prohibited** unless a SIC Declaration of Conformity or a statutory exception applies.
- **Adequate jurisdictions (2025)**: USA, EU, UK, Canada, Japan, South Korea, Mexico, Peru, Serbia, others.
- **Transfer vs Transmission**: Transfer = recipient becomes independent Controller; Transmission = recipient is a Processor under a Data Transmission Agreement.
- **Impact**: Supabase Cloud region must be in an adequate country (US/EU/UK all qualify). Supabase acts as a **Processor** → a Data Transmission Agreement applying Law 1581 obligations is required.

## Security & breach management

- "Technical, human, and administrative measures" required, proportional to data sensitivity.
- **Breach notification to SIC within 15 business days** of detection (via RNBD portal).
- For sensitive data (religious background), SIC expects higher resilience standards — encryption for sensitive fields at rest (`pgcrypto`) and in transit (TLS, already Supabase default).

## RNBD registration

- Only mandatory for: public legal entities, or private/non-profit entities with total assets > 100,000 UVT (~COP $4.98B / ~USD $1.1M for FY2025).
- A prayer group is very likely **exempt** from RNBD registration, but **remains fully liable** for every other Law 1581 duty (consent, ARCO, security, breach notice, PDTP).

## Penalties

- Fines up to **2,000 monthly legal minimum wages** (~USD $500K–$600K).
- Temporary suspension of processing activities; in extreme cases, permanent closure.
- Recent enforcement: $214M COP fine (2025) for mandatory facial recognition; sanctions for marketing without prior authorization; sanctions for blocking rectification rights.

## Retention + deletion alignment (user decision)

- User decided: **soft-deleted records retained 90 days**, then eligible for purge; **hard delete exclusive to Super Admin** (the priest).
- This aligns with the ARCO **cancellation/suppression** right (deletion when purpose fulfilled or law violated) and the "database duration" field required in the PDTP.
- A scheduled job (Supabase Edge Function / pg_cron) should purge rows where `deleted_at < now() - interval '90 days'`, with the audit log retaining a tombstone record.

## Spec-phase requirements to capture (summary)

1. Capture form: general consent (prior/express/informed, no pre-checks) + **separate explicit opt-in for religious background** with "not obliged to provide" notice, in **Spanish**.
2. Minors handling: if DOB indicates <18, require legal-representative authorization and record the minor's assent.
3. Consent records stored & versioned in `audit_log` (policy version, timestamp, acceptance).
4. ARCO/DSAR workflow: access (10bd), rectification/cancellation/opposition (15bd), with designated contact/DPO.
5. PDTP + Privacy Notice (Spanish) accessible from the capture form and app.
6. Encryption at rest for sensitive fields (`pgcrypto` for religious-background columns); TLS in transit (Supabase default).
7. Supabase Cloud region in an adequate country (US/EU/UK); Data Transmission Agreement with Supabase as Processor.
8. Breach-response runbook: 15-business-day SIC notification path.
9. 90-day retention + pg_cron/Edge Function purge + Super-Admin-only hard delete (RLS already planned).
10. Export feature doubles as the ARCO "access/export" fulfillment mechanism.

## Sources

- Secure Privacy — Colombia Data Protection Law: Complete Compliance Guide (Habeas Data): https://secureprivacy.ai/blog/colombia-data-protection-law
- DLA Piper Data Protection Laws in Colombia: https://www.dlapiperdataprotection.com/index.html?t=law&c=CO
- DataGuidance — SIC announces planned amendments to data protection law: https://www.dataguidance.com/news/colombia-sic-announces-planned-amendments-data
- SealPath — Law 1581 Colombia compliance: https://www.sealpath.com/compliance-data-security-solutions/law-1581-colombia/
- Resguard — Colombia's Law 1581 Data Protection Guide: https://resguard-solutions.com/blog/en/colombia-law-1581-data-protection-guide/
- Supabase — Self-Hosting docs (managed vs self-hosted responsibilities): https://supabase.com/docs/guides/self-hosting
