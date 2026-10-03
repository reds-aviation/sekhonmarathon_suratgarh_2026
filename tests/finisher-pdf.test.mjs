import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { certificateDownloadFilename, renderFinisherCertificate, validateFinisherCertificate } from '../lib/finisher-pdf.ts';

const assets = {
  templateBytes: new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=', 'base64')),
  latinFontBytes: new Uint8Array(await readFile(new URL('./fixtures/NotoSans-Regular.ttf', import.meta.url))),
  devanagariFontBytes: new Uint8Array(await readFile(new URL('./fixtures/NotoSansDevanagari-Regular.ttf', import.meta.url))),
};
const record = {
  certificateId: 'SEK26-TEST-ONLY-0001',
  name: 'Synthetic Test Participant',
  race: '5',
  finishTime: '00:32:18',
  issueDate: '2026-10-04',
  status: 'self-declared',
  timingSource: 'self-reported',
  issuedAt: '2026-10-04T05:00:00Z',
};

test('creates one A4 landscape PDF and records self-reported provenance in metadata', async () => {
  const bytes = await renderFinisherCertificate(record, assets);
  const pdf = await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(), 1);
  assert.ok(Math.abs(pdf.getPages()[0].getWidth() - 841.89) < 0.1);
  assert.ok(Math.abs(pdf.getPages()[0].getHeight() - 595.28) < 0.1);
  assert.match(pdf.getSubject(), /Participant-declared.*self-reported.*not an official/u);
  assert.match(pdf.getTitle(), /SEK26-TEST-ONLY-0001/u);
  assert.equal(pdf.getCreationDate().toISOString(), '2026-10-04T05:00:00.000Z');
});

test('supports mixed Devanagari/Latin names and normalises spacing', async () => {
  const input = { ...record, name: '  जयवीर   Singh  ', race: '21', finishTime: '02:15:09' };
  assert.equal(validateFinisherCertificate(input).name, 'जयवीर Singh');
  assert.equal((await PDFDocument.load(await renderFinisherCertificate(input, assets))).getPageCount(), 1);
});

test('rejects invalid times, categories, issue dates and unexpected completion provenance', () => {
  for (const finishTime of ['00:00:00', '00:60:00', '24:00:00', '1:22:33', 'abc']) {
    assert.throws(() => validateFinisherCertificate({ ...record, finishTime }), /finish time/u);
  }
  assert.throws(() => validateFinisherCertificate({ ...record, race: '2' }), /Choose/u);
  assert.throws(() => validateFinisherCertificate({ ...record, issueDate: '2026-10-03' }), /issue date/u);
  assert.throws(() => validateFinisherCertificate({ ...record, status: 'verified' }), /completion status/u);
  assert.throws(() => validateFinisherCertificate({ ...record, timingSource: 'official' }), /timing source/u);
  assert.throws(() => validateFinisherCertificate({ ...record, certificateId: '<script>' }), /certificate number/u);
});

test('unsupported characters and names too wide fail visibly instead of corrupting the certificate', async () => {
  assert.throws(() => validateFinisherCertificate({ ...record, name: 'Runner 🦋' }), /participant name/u);
  await assert.rejects(() => renderFinisherCertificate({ ...record, name: 'W'.repeat(100) }, assets), /does not fit/u);
});

test('all categories render and download filename contains no participant data', async () => {
  for (const race of ['5', '10', '21']) {
    const pdf = await PDFDocument.load(await renderFinisherCertificate({ ...record, race }, assets));
    assert.equal(pdf.getPageCount(), 1);
  }
  assert.equal(certificateDownloadFilename(record), 'Sekhon-Marathon-2026-SEK26-TEST-ONLY-0001.pdf');
});
