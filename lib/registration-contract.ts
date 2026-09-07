/**
 * Shared registration vocabulary for the browser and Supabase Edge Functions.
 * Keep this module dependency-free so it can be imported by either runtime.
 */

export const EVENT_ID = 'suratgarh-2026' as const;
export type EventId = typeof EVENT_ID;

export const RACE_DISTANCES = ['5', '10', '21'] as const;
export type RaceDistance = (typeof RACE_DISTANCES)[number];

/** Publicly announced fees only. The server still reads the authoritative fee at submission time. */
export const CONFIRMED_RACE_FEES_RUPEES = {
  '5': 399,
  '10': 499,
  '21': 499,
} as const satisfies Readonly<Record<RaceDistance, number>>;

export const PARTICIPANT_TYPES = ['airwarrior', 'family'] as const;
export type ParticipantType = (typeof PARTICIPANT_TYPES)[number];

export const GENDERS = [
  'male',
  'female',
  'other',
  'prefer_not_to_say',
] as const;
export type Gender = (typeof GENDERS)[number];

export const T_SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'] as const;
export type TShirtSize = (typeof T_SHIRT_SIZES)[number];

export const BLOOD_GROUPS = [
  'A+',
  'A-',
  'B+',
  'B-',
  'AB+',
  'AB-',
  'O+',
  'O-',
  'Unknown',
] as const;
export type BloodGroup = (typeof BLOOD_GROUPS)[number];

export const PAYMENT_STATUSES = [
  'pending_review',
  'verified',
  'rejected',
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/**
 * These values are created or controlled by the server. They must never be
 * accepted from the JSON participant payload sent by the browser.
 */
export const SERVER_OWNED_REGISTRATION_FIELDS = [
  'id',
  'registration_id',
  'user_id',
  'email',
  'fee_paise',
  'receipt',
  'receipt_path',
  'receipt_url',
  'payment_status',
  'payment_review_status',
  'review_status',
  'reviewed_by',
  'reviewed_at',
  'review_notes',
  'created_at',
  'updated_at',
] as const;
export type ServerOwnedRegistrationField =
  (typeof SERVER_OWNED_REGISTRATION_FIELDS)[number];

/**
 * The exact JSON keys allowed in the multipart `payload` field. The payment
 * screenshot itself is attached separately; its path and metadata are server-owned.
 */
export const CLIENT_REGISTRATION_SUBMISSION_FIELDS = [
  'event_id',
  'submission_id',
  'full_name',
  'mobile',
  'dob',
  'gender',
  'race',
  'tshirt',
  'blood_group',
  'emergency_contact',
  'city',
  'participant_type',
  'transaction_id',
  'consent',
] as const;
export type ClientRegistrationSubmissionField =
  (typeof CLIENT_REGISTRATION_SUBMISSION_FIELDS)[number];

type ClientRegistrationSubmissionValues = {
  event_id: EventId;
  submission_id: string;
  full_name: string;
  mobile: string;
  dob: string;
  gender: Gender;
  race: RaceDistance;
  tshirt: TShirtSize;
  blood_group: BloodGroup;
  emergency_contact: string;
  city: string;
  participant_type: ParticipantType;
  transaction_id: string;
  consent: true;
};

/** The browser may submit only these participant-provided values. */
export type ClientRegistrationSubmission = {
  readonly [Field in ClientRegistrationSubmissionField]:
    ClientRegistrationSubmissionValues[Field];
};

type ClientSubmissionExcludesServerOwnedFields = Extract<
  ClientRegistrationSubmissionField,
  ServerOwnedRegistrationField
> extends never
  ? true
  : false;

/** Compile-time tripwire for accidental exposure of a server-owned field. */
export const CLIENT_SUBMISSION_EXCLUDES_SERVER_OWNED_FIELDS: ClientSubmissionExcludesServerOwnedFields =
  true;

export type RegistrationSubmissionSuccess = {
  readonly registration_id: string;
  readonly payment_status: PaymentStatus;
};

export type RegistrationSubmissionFailure = {
  readonly error: string;
};

/** Response shape exposed to the participant after a submission attempt. */
export type RegistrationSubmissionResult =
  | RegistrationSubmissionSuccess
  | RegistrationSubmissionFailure;
