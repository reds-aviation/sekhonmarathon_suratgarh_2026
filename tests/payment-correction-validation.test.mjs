import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePaymentCorrectionPayload} from '../supabase/functions/submit-registration/validation.ts';

const valid = {
  event_id: 'suratgarh-2026',
  registration_id: '10000000-0000-4000-8000-000000000701',
  correction_id: '20000000-0000-4000-8000-000000000701',
  transaction_id: 'UPI-REF-701',
};

test('payment correction payload accepts only canonical event, IDs and UTR data', () => {
  assert.deepEqual(validatePaymentCorrectionPayload({...valid, transaction_id: 'upi-ref-701'}), {
    event_id: 'suratgarh-2026',
    registration_id: valid.registration_id,
    correction_id: valid.correction_id,
    transaction_id: 'upi-ref-701',
  });
  for (const change of [
    {event_id: 'other-event'},
    {registration_id: 'not-a-uuid'},
    {correction_id: 'not-a-uuid'},
    {transaction_id: '123'},
    {transaction_id: 'UTR<script>'},
    {transaction_id: 'A'.repeat(65)},
  ]) assert.throws(() => validatePaymentCorrectionPayload({...valid, ...change}));
});
