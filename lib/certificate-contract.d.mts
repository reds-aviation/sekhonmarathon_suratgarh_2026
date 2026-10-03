export type CertificateRace = '5' | '10' | '21';
export type CertificateIssueInput = {
  requestId: string;
  name: string;
  race: CertificateRace;
  finishTime: string;
  completionDeclared: boolean;
};
export type IssuedCertificate = {
  certificateId: string;
  name: string;
  race: CertificateRace;
  finishTime: string;
  issueDate: string;
  issuedAt: string;
  status: 'self-declared';
  timingSource: 'self-reported';
  templateVersion: string;
};
export type CertificateAvailability = {
  available: boolean;
  releaseEnabled: boolean;
  releaseAt: string;
  issueDate: string;
  serverTime: string;
  templateVersion: string | null;
  reason: 'disabled' | 'template_not_ready' | 'scheduled' | 'open';
  declaration: string;
};
export const CERTIFICATE_RELEASE_AT: string;
export const CERTIFICATE_ISSUE_DATE: string;
export const CERTIFICATE_TEMPLATE_VERSION: string;
export const CERTIFICATE_ENDPOINT: string;
export const CERTIFICATE_DECLARATION: string;
export const CERTIFICATE_RACES: readonly CertificateRace[];
export function normalizeParticipantName(value: unknown): string;
export function validateCertificateInput(input: unknown): {
  valid: boolean;
  value?: CertificateIssueInput;
  errors: Record<string, string>;
};
export function certificateFingerprint(
  input: Pick<CertificateIssueInput, 'name' | 'race' | 'finishTime'>,
): string;
