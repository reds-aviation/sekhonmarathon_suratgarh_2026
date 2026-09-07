import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BLOOD_GROUPS,
  CLIENT_REGISTRATION_SUBMISSION_FIELDS,
  CLIENT_SUBMISSION_EXCLUDES_SERVER_OWNED_FIELDS,
  CONFIRMED_RACE_FEES_RUPEES,
  EVENT_ID,
  GENDERS,
  PARTICIPANT_TYPES,
  PAYMENT_STATUSES,
  RACE_DISTANCES,
  SERVER_OWNED_REGISTRATION_FIELDS,
  T_SHIRT_SIZES,
} from '../lib/registration-contract.ts';

void test('publishes the fixed Suratgarh event vocabulary', () => {
  assert.equal(EVENT_ID, 'suratgarh-2026');
  assert.deepEqual(RACE_DISTANCES, ['5', '10', '21']);
  assert.deepEqual(PARTICIPANT_TYPES, ['airwarrior', 'family']);
  assert.deepEqual(GENDERS, [
    'male',
    'female',
    'other',
    'prefer_not_to_say',
  ]);
  assert.deepEqual(T_SHIRT_SIZES, ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']);
  assert.deepEqual(BLOOD_GROUPS, [
    'A+',
    'A-',
    'B+',
    'B-',
    'AB+',
    'AB-',
    'O+',
    'O-',
    'Unknown',
  ]);
  assert.deepEqual(PAYMENT_STATUSES, [
    'pending_review',
    'verified',
    'rejected',
  ]);
});

void test('keeps published race fees aligned to the confirmed categories', () => {
  assert.deepEqual(CONFIRMED_RACE_FEES_RUPEES, {
    5: 399,
    10: 499,
    21: 499,
  });
});

void test('allows only participant-provided keys in the client submission payload', () => {
  assert.deepEqual(CLIENT_REGISTRATION_SUBMISSION_FIELDS, [
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
  ]);

  const submittedFields = new Set(CLIENT_REGISTRATION_SUBMISSION_FIELDS);
  for (const serverOwnedField of SERVER_OWNED_REGISTRATION_FIELDS) {
    assert.equal(
      submittedFields.has(serverOwnedField),
      false,
      `${serverOwnedField} must be assigned by the server`,
    );
  }
  assert.equal(CLIENT_SUBMISSION_EXCLUDES_SERVER_OWNED_FIELDS, true);
});
