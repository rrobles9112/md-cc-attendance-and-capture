export interface ConsentValidationResult {
  valid: boolean
  error?: string
}

export function validateGeneralConsent(checked: boolean): ConsentValidationResult {
  if (!checked) {
    return { valid: false, error: 'El consentimiento general es obligatorio para procesar datos personales.' }
  }
  return { valid: true }
}

export function validateSensitiveConsent(checked: boolean): ConsentValidationResult {
  // Sensitive consent is optional — no error if unchecked
  // If checked, it's a valid explicit opt-in
  return { valid: true }
}

export interface MinorCheckResult {
  isMinor: boolean
  requiresLegalRep: boolean
}

export function checkMinorStatus(birthday: Date): MinorCheckResult {
  const today = new Date()
  let age = today.getFullYear() - birthday.getFullYear()
  const monthDiff = today.getMonth() - birthday.getMonth()

  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthday.getDate())) {
    age--
  }

  const isMinor = age < 18

  return {
    isMinor,
    requiresLegalRep: isMinor,
  }
}

export function validateMinorFields(
  isMinor: boolean,
  legalRepName?: string
): ConsentValidationResult {
  if (isMinor && (!legalRepName || legalRepName.trim() === '')) {
    return {
      valid: false,
      error: 'Para menores de 18 años, el nombre del representante legal es obligatorio.',
    }
  }
  return { valid: true }
}
