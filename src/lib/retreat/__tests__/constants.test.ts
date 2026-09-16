import { describe, expect, it } from 'vitest'
import {
  RETREAT_CREATE_DIALOG_DESCRIPTION,
  RETREAT_DASHBOARD_DESCRIPTION,
  RETREAT_DASHBOARD_HEADING,
  RETREAT_EVENT_KEY,
  RETREAT_PAGE_DESCRIPTION,
  RETREAT_PAGE_HEADING,
  RETREAT_PAGE_KICKER,
} from '../constants'

describe('retreat public branding copy', () => {
  it('keeps the October 2026 event key and shows Un Corazón Nuevo from the campaign poster', () => {
    expect(RETREAT_EVENT_KEY).toBe('retiro-juvenil-octubre-2026')
    expect(RETREAT_PAGE_KICKER).toBe('Retiro juvenil')
    expect(RETREAT_PAGE_HEADING).toBe('Un Corazón Nuevo')
    expect(RETREAT_PAGE_DESCRIPTION).toBe(
      'Un espíritu nuevo · Ezequiel 36,26. 23, 24 y 25 de octubre. Complete el formulario para preinscribirse. Esta preinscripción no es una inscripción completa.',
    )
    expect(RETREAT_DASHBOARD_HEADING).toBe('Preinscripciones — Un Corazón Nuevo')
    expect(RETREAT_DASHBOARD_DESCRIPTION).toBe(
      'Consulte las preinscripciones al retiro Un Corazón Nuevo y registre cuotas consecutivas',
    )
    expect(RETREAT_CREATE_DIALOG_DESCRIPTION).toContain('Un Corazón Nuevo')
    expect(RETREAT_CREATE_DIALOG_DESCRIPTION).toContain('Ley 1581 pdtp-v1.0-2026-07-17')
  })
})
