# Retiro — Condiciones médicas dinámicas

## Goal

Add opt-in medical-conditions section (has condition? which / medications / dosage-hours) to all retreat pre-registration forms, mirroring the sensitive-consent pattern.

## Tasks

- [ ] 1. Migration 023: columns + restate both RPCs with trailing medical params
- [ ] 2. CaptureForm: payload fields, state, validation, medical card (retreat only)
- [ ] 3. submit-adapter + update.ts + RetreatPreinscriptionEdit wiring
- [ ] 4. queries.ts SELECT + dashboard row type
- [ ] 5. Tests updated + new medical cases; `tsc` + `vitest run` green
