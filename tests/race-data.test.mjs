import test from 'node:test';
import assert from 'node:assert/strict';
import { RACE_FEES, RACES } from '../lib/race-data.ts';

void test('publishes the confirmed Suratgarh fees consistently for every race', () => {
  assert.deepEqual(RACE_FEES, { 5: 200, 10: 250, 21: 250 });
  assert.deepEqual(
    RACES.map(({ distance, fee }) => ({ distance, fee })),
    [
      { distance: '5', fee: 200 },
      { distance: '10', fee: 250 },
      { distance: '21', fee: 250 },
    ],
  );
});
