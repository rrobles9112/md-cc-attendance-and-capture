# Deployment Runbook

Production deployment, rollback, and breach notification procedures for the Attendance & Data Capture Platform.

## Production Deployment

### Prerequisites

- GitHub Actions secrets configured:
  - `VERCEL_TOKEN`
  - `SUPABASE_ACCESS_TOKEN`
  - `SUPABASE_PROJECT_REF`
- Vercel project linked to the GitHub repo
- Supabase project provisioned (Cloud)

### Automatic Deployment (CI/CD)

Pushing to `main` triggers the `deploy-production.yml` workflow:

1. **Test gate**: lint → typecheck → unit tests → build
2. **Migrate**: `supabase db push --linked` applies pending migrations
3. **Deploy**: `vercel --prod` deploys to production

All three steps must pass. If any step fails, subsequent steps are skipped.

### Manual Deployment

If CI/CD is unavailable:

```bash
# 1. Ensure tests pass locally
npm run lint && npx tsc --noEmit && npx vitest run && npm run build

# 2. Apply migrations
supabase link --project-ref=$SUPABASE_PROJECT_REF
supabase db push --linked

# 3. Deploy to Vercel
npx vercel --prod
```

### Post-Deployment Checklist

- [ ] Verify app loads at production URL
- [ ] Login works (test with super_admin)
- [ ] Capture form submits successfully
- [ ] Attendance marking works
- [ ] Realtime updates visible across sessions
- [ ] Export generates valid XLSX/CSV
- [ ] Sync indicator shows correct status
- [ ] Check Supabase logs for errors

## Rollback

### Vercel Rollback

Instant rollback to any previous deployment:

```bash
# Via CLI
npx vercel rollback

# Or via Vercel Dashboard
# 1. Go to vercel.com → project → Deployments
# 2. Find the last known-good deployment
# 3. Click "Promote to Production"
```

### Supabase Migration Rollback

If a migration causes issues:

```bash
# Option 1: Revert the migration file and push
# 1. Revert the migration file in supabase/migrations/
# 2. Commit and push to main
# 3. CI will apply the reverted migration

# Option 2: Manual rollback (if you know the SQL)
supabase link --project-ref=$SUPABASE_PROJECT_REF
supabase db reset  # ⚠️ This resets ALL data — use with caution
```

> **Warning**: `supabase db reset` destroys all data. Only use in development/staging. For production, write a manual rollback migration.

### Full Rollback Procedure

1. **Vercel**: Roll back to previous deployment (instant)
2. **Supabase**: If migration is the issue, deploy a revert migration
3. **Verify**: Check app functionality after rollback
4. **Notify**: Inform the team of the rollback and root cause

## Breach Notification Workflow

Per Colombian Ley 1581 de 2012 and Decree 1377/2013:

### Detection

1. Data breach is detected (unauthorized access, data leak, etc.)
2. Log the breach in the system with:
   - Detection date
   - Nature of the breach
   - Data affected
   - Number of records

### Timeline

| Action | Deadline |
|--------|----------|
| Internal assessment | Immediate (within 24 hours) |
| Notification to SIC | 15 business days from detection |
| Notification to affected data subjects | 15 business days from detection |

### Notification Process

1. **Document the breach**:
   - What data was exposed
   - How many records affected
   - How the breach occurred
   - Steps taken to contain it

2. **Notify SIC (Superintendencia de Industria y Comercio)**:
   - Via SIC's online notification system
   - Include: description, scope, mitigation measures, timeline

3. **Notify affected data subjects**:
   - Direct notification (email/phone if available)
   - Include: what happened, what data was affected, what they should do, contact information

4. **Remediation**:
   - Fix the vulnerability
   - Implement additional security measures
   - Document lessons learned

### Template: SIC Notification

```
ASUNTO: Notificación de incidente de seguridad de datos personales

RESPONSABLE: [Nombre de la comunidad religiosa]
NIT/ID: [Identificación]
FECHA DE DETECCIÓN: [Fecha]
FECHA DE OCURRENCIA: [Fecha si conocida]

DESCRIPCIÓN DEL INCIDENTE:
[Descripción detallada]

DATOS AFECTADOS:
[Tipos de datos personales comprometidos]

PERSONAS AFECTADAS:
[Número estimado]

MEDIDAS DE MITIGACIÓN:
[Acciones tomadas]

MEDIDAS PREVENTIVAS:
[Acciones futuras]

CONTACTO: [DPO/Responsable de protección de datos]
```

## Monitoring

### Supabase Dashboard

- **Database**: Monitor query performance, connections, storage
- **Auth**: Check for unusual login patterns
- **Logs**: Review Edge Function and database logs

### Application Health

- **Sync indicator**: Monitor sync queue health
- **Error tracking**: Check for JS errors in production
- **Uptime**: Monitor availability via Vercel dashboard

## Emergency Contacts

| Role | Contact |
|------|---------|
| Technical Lead | [Name, phone, email] |
| DPO (Data Protection Officer) | [Name, phone, email] |
| Supabase Support | support@supabase.io |
| Vercel Support | support@vercel.com |
