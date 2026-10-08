# contacto-emergencia-captura

## Objective

Agregar un contacto de emergencia (nombre completo, parentesco, teléfono móvil) a la captura de miembros y a todas las superficies de preinscripción al retiro, para seguimiento pastoral: cuando el contacto principal no contesta, se pueda llamar al contacto de emergencia.

## Problem

Hoy los formularios solo capturan representante legal (condicional a menores, obligación Ley 1581) y WhatsApp secundario (que alimenta mensajería vía transfer a Valientes). No existe un contacto de emergencia explícito con parentesco.

## Scope

Estrategia ADITIVA (decidida con el usuario): el representante legal para menores y el WhatsApp secundario se mantienen intactos; el contacto de emergencia son 3 campos nuevos.

- retreat: migración 026 (columnas en `retreat_registrations` + `members`, ambos RPC de preinscripción restateados con params trailing opcionales)
- CaptureForm: card "Contacto de emergencia" en AMBAS variantes (`member` y `retreat`), payload + validación (si hay nombre, parentesco y teléfono son obligatorios)
- Retreat: submit-adapter (2 adapters), lib/retreat/update.ts, RetreatPreinscriptionEdit, queries SELECT, export.ts
- Members: Dexie Member type + ruta Dexie de CaptureForm, lib/members/update.ts, diálogo de edición en members/page.tsx, export/page.tsx
- Tests: vitest (CaptureForm, update retreat, update members, submit-adapter), caso SQL en supabase/tests, `tsc` + `vitest run` en verde

## Constraints

- Aditivo: nada de eliminar o renombrar `legal_rep_name` / `has_whatsapp` / `whatsapp_number`; los RPCs existentes se restatean con el mismo cuerpo + params trailing con DEFAULT NULL (patrón 023).
- Consentimientos Ley 1581 sin cambios.
- Writes single-threaded; un writer por tanda.

## Acceptance criteria

- Los 3 campos persisten vía `register_retreat_preinscription`, `register_retreat_preinscription_for_member`, el update de preinscripción (PostgREST) y la ruta Dexie de miembros.
- Visibles y editables en: form público /retiro, Nueva preinscripción, Editar preinscripción, captura de miembros, edición de miembros.
- Presentes en exports (retreat report + members export).
- `npx tsc --noEmit` y `npx vitest run` en verde; test SQL del caso nuevo pasa.

## Tasks

- [ ] T1 — Migración 026: columnas retreat_registrations + members, ambos RPC restateados con `p_emergency_contact_*`. Route: inline (delegación no disponible en esta sesión de provider; trigger: archivo único, mecánico sobre precedente 023).
- [ ] T2 — CaptureForm: payload + estado + validación + card en ambas variantes; ruta Dexie de miembros escribe los 3 campos. Route: inline; trigger writer: 2+ archivos no triviales (delegación no disponible → inline con disclamer).
- [ ] T3 — Retreat: submit-adapter (2 adapters) + update.ts + RetreatPreinscriptionEdit (inputs + select de parentesco).
- [ ] T4 — Members: update.ts + members/page.tsx (diálogo edición) + export/page.tsx.
- [ ] T5 — queries.ts SELECT + export.ts (reporte retreat) + tests vitest/SQL + `tsc` + `vitest run`.

## Progress

(sin commits aún)
