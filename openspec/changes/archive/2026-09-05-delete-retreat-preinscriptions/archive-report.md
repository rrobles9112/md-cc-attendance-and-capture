# Archive Report — delete-retreat-preinscriptions

Status: **PASS** (cierre con sincronización canónica y movimiento diferidos a post-merge — ver § Sync y § Movimiento).

## Artefactos leídos

- `openspec/changes/delete-retreat-preinscriptions/explore.md`
- `openspec/changes/delete-retreat-preinscriptions/proposal.md`
- `openspec/changes/delete-retreat-preinscriptions/specs/delete-retreat-preinscriptions/spec.md` (9 requirements, R1–R9)
- `openspec/changes/delete-retreat-preinscriptions/design.md`
- `openspec/changes/delete-retreat-preinscriptions/tasks.md` (T1–T7 `[x]`, T8 `[ ]` parent-owned)
- `openspec/changes/delete-retreat-preinscriptions/apply-progress.md`
- `openspec/changes/delete-retreat-preinscriptions/verify-report.md` (PASS 9/9, 0 CRITICAL)
- Engram: obs 115 (explore), 116 (proposal), 117 (spec), 118 (design), 119 (tasks), 120 (apply-progress), 122 (verify-report PASS 9/9).

## Estado final (prevalece sobre snapshots intermedios — hechos del parent)

1. **Stack de 3 PRs PUBLICADO y OPEN** (stacked-to-main, merge en orden 1→2→3 con retarget a main):
   - PR #134 `feat/delete-retreat-pr1-migration` → main (migración 021, SHA 5b8330d).
   - PR #135 `feat/delete-retreat-pr2-tests` → rama PR1 (suite S1–S8, SHA 3e539ed).
   - PR #136 `feat/delete-retreat-pr3-ui` → rama PR2 (UI + guards, SHA 75b52cf).
   - URLs: `github.com/rrobles9112/md-cc-attendance-and-capture/pull/134`, `/135`, `/136`.
2. **Validación por rama (post verify-report):** SQL S1–S8 9/9 PASS en Supabase local; tsc exit 0 en PR3; `guards.test.ts` 53/53 (50 HEAD + 3 nuevos); 5 suites retreat/rbac 34/34 en PR3.
3. **Verify final:** 9/9 requirements PASS, 0 CRITICAL (Engram obs 122). Warning de presupuesto resuelto por el usuario (decisión: stacked PRs).
4. **Ledger nativo:** apply settled `passed` (787 líneas, reset autorizado por Richard Robles por exceso sobre 450); verify settled `passed` (96 líneas sobre tope 60, reset autorizado); `decision_required: False`. Dos resets ejecutados con actor "Richard Robles", ambos autorizados explícitamente.
5. **T8 bounded review:** revisión nativa con `gentle_review inspect` mostró candidato = worktree sucio dominado por ruido preexistente del revert (R6, 74 archivos) — NO se inició review nativa sobre ese candidato (habría revisado ruido ajeno al cambio); la revisión humana ocurre en los PRs #134–#136. Bounded review satisfecho vía verify + validación por rama + gates de cada fase.
6. **Worktrees auxiliares** `../MD_CC_STACK_PR1/2/3` removidos post-push (`git worktree remove --force`); el worktree principal conserva su estado sucio preexistente + archivos del cambio sin commitear.
7. **Decisiones del usuario en sesión:** roles super_admin+leader; UI con 3 opciones explícitas; stacked PRs; apilados a main; dos resets autorizados.
8. **Divergencia conocida:** DB Supabase local en baseline 011+021 (sin 013–020) — `retreat_rls.test.sql` de HEAD no puede pasar ahí por skew de entorno (firma RPC vieja), preexistente y ajeno al cambio.

## Tareas — reconciliación explícita de T8

`tasks.md` re-leído antes del cierre: T1–T7 `[x]`; la única línea `- [ ]` restante es:

- `- [ ] T8 — Bounded review post-apply del PR único (~370 líneas) y gate de lifecycle correspondiente. <!-- sdd-owner: parent -->`

**Reconciliación stale-checkbox (excepcional, autorizada por hechos finales del parent):** T8 era parent-owned y su supuesto original (PR único ~370 líneas) quedó obsoleto por la decisión del usuario de stacked PRs. Se declara completa por equivalencia: (a) verify PASS 9/9 obs 122; (b) validación por rama post-verify (SQL 9/9, tsc 0, guards 53/53, suites 34/34); (c) revisión humana delegada a los PRs #134–#136; (d) ledger nativo `decision_required: False` en apply y verify. No se modificó `tasks.md` (el parent es dueño de T8); esta sección es la prueba registrada.

## Dominios sincronizados

**NINGUNO — sync canónico DIFERIDO a post-merge (decisión deliberada, no omisión).** No existe `sync-report.md` y no se ejecutó fallback de sync en archive porque: los PRs #134–#136 están OPEN sin merge, y aplicar ADDED/MODIFIED/REMOVED contra `openspec/specs/` antes del merge sería prematuro (el código aún no está en main). Requisito pendiente post-merge vía `sdd-sync`: dominio `delete-retreat-preinscriptions` (9 requirements R1–R9 → ADDED). Sin warnings de colisión entre cambios activos (no verificado — verificar en sync post-merge).

## Structured status y actionContext

- `openspec/config.yaml`: `strict_tdd: true` → TDD estricta aplicada y verificada (verify § Strict TDD).
- Baseline revertido preexistente (R6/N8, 74 archivos) contaminó el diff global durante apply/verify; la medición aislada por archivo + validación por rama en worktrees limpios lo resolvió.
- Destructive merge guard: N/A (sin REMOVED/MODIFIED aplicados; diferido al sync post-merge).
- `rules.archive` de `openspec/config.yaml`: sin reglas adicionales encontradas/aplicadas.

## Movimiento a archivo

**NO MOVIDO — diferido a post-merge.** La carpeta permanece en `openspec/changes/delete-retreat-preinscriptions/` (incluyendo este reporte) hasta que el usuario complete el merge 1→2→3; entonces: `sdd-sync` (reporte + merge canónico) y luego mover a `openspec/changes/archive/YYYY-MM-DD-delete-retreat-preinscriptions/`. Mover ahora rompería la trazabilidad de los PRs abiertos.

## Riesgos residuales

1. PRs sin mergear: el cambio no está en main; riesgo de divergencia si HEAD avanza — mitigado por stack apilado con retarget.
2. Sync canónico pendiente post-merge (ADDED R1–R9) — no olvidar `sdd-sync` antes del move a archive.
3. Skew de entorno local (011+021 sin 013–020) documentado; revalidar suite completa tras rebase a HEAD completo.
4. Worktree principal aún sucio (ruido preexistente del revert + archivos del cambio sin commitear ya pusheados vía worktrees removidos).

## Trazabilidad Engram

topics `sdd/delete-retreat-preinscriptions/*`: explore obs 115, proposal 116, spec 117, design 118, tasks 119, apply-progress 120, verify-report 122. Este reporte: topic `sdd/delete-retreat-preinscriptions/archive-report` (ver envelope de retorno para observation id).

## Addendum post-merge (2026-10-12)

**Sync canónico EJECUTADO y movimiento a archivo REALIZADO** (file-op local; ver notas de entrega abajo).

- PRs #134–#136 mergeados en main (2026-09-05); verify 9/9 ya registrado en este reporte. `decision_required: False` (T8 reconciliado por equivalencia).
- Sync canónico: `openspec/specs/delete-retreat-preinscriptions/spec.md` creado con las requirements R1–R9 del delta (sin REMOVED/MODIFIED — destructive merge guard N/A confirmado).
- Movimiento: carpeta movida a `openspec/changes/archive/2026-09-05-delete-retreat-preinscriptions/`.
- **Nota de entrega (gate humano)**: el move se hizo como operación de archivo local sin commit. El commit git queda pendiente de aprobación explícita del usuario (requiere angostar `.git/info/exclude` — las carpetas de `openspec/changes/` quedaron untracked por un bloque local agregado para el review RDD — y `git add`). Las specs canónicas de los otros dos cambios hermanos se sincronizaron el mismo día.
- Seguimiento arrastrado: `supabase/tests/retreat_delete.test.sql` no está en la lista explícita de tests SQL del CI (`.github/workflows/ci.yml` líneas 82–96); el test se ejecutó manualmente en su momento. Mismo gap que `app_settings_insert.test.sql` de `fix-retiro-costo-total` — resolver en un único cambio de CI.
