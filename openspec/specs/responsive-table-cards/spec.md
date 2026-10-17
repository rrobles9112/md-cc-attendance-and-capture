# Spec: Responsive Card Layout for shadcn/ui Tables (ADR-RESPONSIVE-TABLE-CARDS)

- **Status**: Active Architectural Decision
- **Effective Date**: 2026-10-17
- **Applies To**: All current and future tables built with `@/components/ui/table` (`shadcn/ui`)

## Context & Problem

On mobile (`< 640px`), tablets (`640px–1023px`), and medium-resolution screens (`1024px–1279px`), multi-column `shadcn/ui` tables either hide critical columns via `hidden sm:table-cell` / `hidden md:table-cell` / `hidden lg:table-cell` or overflow horizontally, degrading readability and making action buttons (`botonera`) difficult to use.

## Decision

1. **Mandatory Responsive Card Pattern (`< 1280px`)**:
   - Whenever `useIsCompactTableViewport()` (`(max-width: 1279px)`) matches (covering mobile, tablets, and medium-resolution viewports), tables MUST NOT render `<tr>` rows that hide columns or force horizontal scrolling.
   - Instead, each record MUST render as a `<ResponsiveTableCard>` inside `<ResponsiveTableCards>` (`@/components/ui/responsive-table`), displaying:
     - **Card Header (`<ResponsiveTableCardHeader>`)**: Primary record identifier, leading selection/status control (if any), and status badges.
     - **Card Fields (`<ResponsiveTableCardFields>`)**: Every visible column label (`<dt>`) and row value (`<dd>`) for that record.
     - **Card Action Bar / Botonera (`<ResponsiveTableCardActions>`)**: All row-level action buttons (`botonera`) for that record.
2. **Desktop & Print (`>= 1280px` or Print Media)**:
   - On large desktop viewports (`>= 1280px`) and during print (`beforeprint`/`afterprint`), the standard `<Table>` component is rendered.
3. **Single Active Representation in DOM**:
   - Components MUST branch on `useIsCompactTableViewport()` rather than mounting both `<Table>` and `<ResponsiveTableCards>` simultaneously with CSS `hidden`, preserving accessible role counts and deterministic DOM queries.
4. **Forward-Looking Rule**:
   - Every new table introduced in the application that uses `@/components/ui/table` MUST implement this responsive `<ResponsiveTableCards>` pattern for mobile, tablet, and medium-resolution viewports.

## Covered Surfaces

- `src/app/(dashboard)/retreat-registrations/page.tsx`
- `src/app/(dashboard)/members/page.tsx`
- `src/components/forms/AttendanceGrid.tsx`
- `src/components/pastoreo/ChronicTable.tsx`
- `src/components/admin/UsersPanel.tsx`
- `src/app/(dashboard)/admin/page.tsx` (Audit log, ARCO requests, Sync queue failures)
