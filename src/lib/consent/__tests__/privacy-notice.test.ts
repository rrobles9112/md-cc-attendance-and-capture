import { describe, expect, it } from 'vitest'
import { PRIVACY_NOTICE_ES, RETREAT_PRIVACY_NOTICE_ES } from '../privacy-notice'

describe('RETREAT_PRIVACY_NOTICE_ES', () => {
  it('states Ley 1581, retreat pre-registration purpose, and ARCO rights', () => {
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(/Ley 1581/)
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(/preinscripci/i)
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(/retiro/i)
    expect(RETREAT_PRIVACY_NOTICE_ES).toMatch(/ARCO/)
  })

  it('is not the attendance-only capture notice', () => {
    expect(RETREAT_PRIVACY_NOTICE_ES).not.toBe(PRIVACY_NOTICE_ES)
    expect(RETREAT_PRIVACY_NOTICE_ES).not.toMatch(
      /Registro de asistencia a actividades de la comunidad/,
    )
  })
})
