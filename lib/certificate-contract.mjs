export const CERTIFICATE_RELEASE_AT = '2026-10-04T05:00:00.000Z';
export const CERTIFICATE_ISSUE_DATE = '2026-10-04';
export const CERTIFICATE_TEMPLATE_VERSION = 'finisher-2026-v1';
export const CERTIFICATE_ENDPOINT = '/.netlify/functions/certificates';
export const CERTIFICATE_DECLARATION =
  'I confirm that I completed my selected race. My finish time is self-reported.';
export const CERTIFICATE_RACES = Object.freeze(['5', '10', '21']);

export function normalizeParticipantName(value) {
  return typeof value === 'string'
    ? value.normalize('NFC').trim().replace(/\s+/gu, ' ')
    : '';
}

export function validateCertificateInput(input) {
  const errors = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return {
      valid: false,
      errors: { form: 'Enter your certificate details.' },
    };
  }
  const name = normalizeParticipantName(input.name);
  if (
    Array.from(name).length < 1 ||
    Array.from(name).length > 80 ||
    !/^[\p{L}\p{M} .\u2019'-]+$/u.test(name) ||
    !/\p{L}/u.test(name) ||
    /[\p{Cc}\p{Cf}\p{Cs}]/u.test(input.name ?? '')
  ) {
    errors.name =
      'Enter your name using letters, spaces, apostrophes, dots or hyphens (up to 80 characters).';
  }
  if (!CERTIFICATE_RACES.includes(input.race)) {
    errors.race = 'Choose 5 km, 10 km or 21 km.';
  }
  const finishTime =
    typeof input.finishTime === 'string' ? input.finishTime.trim() : '';
  const match = /^(\d{2}):(\d{2}):(\d{2})$/u.exec(finishTime);
  const hours = match ? Number(match[1]) : -1;
  const minutes = match ? Number(match[2]) : -1;
  const seconds = match ? Number(match[3]) : -1;
  const duration = hours * 3600 + minutes * 60 + seconds;
  if (
    !match ||
    minutes > 59 ||
    seconds > 59 ||
    duration <= 0 ||
    duration > 86399
  ) {
    errors.finishTime =
      'Enter a finish time between 00:00:01 and 23:59:59 in HH:MM:SS format.';
  }
  if (input.completionDeclared !== true) {
    errors.completionDeclared =
      'Confirm that you completed your selected race.';
  }
  if (
    typeof input.requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      input.requestId,
    )
  ) {
    errors.requestId = 'Refresh the page and try again.';
  }
  return Object.keys(errors).length
    ? { valid: false, errors }
    : {
        valid: true,
        value: {
          name,
          race: input.race,
          finishTime,
          completionDeclared: true,
          requestId: input.requestId.toLowerCase(),
        },
        errors: {},
      };
}

export function certificateFingerprint(input) {
  return JSON.stringify([
    normalizeParticipantName(input.name).toLocaleLowerCase('en-IN'),
    input.race,
    input.finishTime.trim(),
  ]);
}
