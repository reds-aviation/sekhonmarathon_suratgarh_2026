import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { PDFFont } from 'pdf-lib';
import 'regenerator-runtime/runtime.js';
import fontkit from '@pdf-lib/fontkit';
import QRCode from 'qrcode';

export type FinisherCertificateRecord = {
  certificateId: string;
  name: string;
  race: '5' | '10' | '21';
  finishTime: string;
  issueDate: '2026-10-04';
  status?: 'self-declared';
  timingSource?: 'self-reported';
  issuedAt?: string;
};

export type FinisherPdfAssets = {
  templateBytes: Uint8Array;
  latinFontBytes: Uint8Array;
  devanagariFontBytes: Uint8Array;
  /** Original artwork has a blank strip below its printed frame. */
  templatePrintedHeightRatio?: number;
  /** For local design samples only; normal downloads never enable this. */
  preview?: boolean;
};

const PAGE_WIDTH = 841.89;
const PAGE_HEIGHT = 595.28;
const SOURCE_WIDTH = 1448;
const SOURCE_HEIGHT = 1036;
const NAVY = rgb(0.025, 0.115, 0.4);
const MUTED = rgb(0.17, 0.25, 0.4);
/** Printed authority name only; this QR is neither a signature nor verification. */
export const FINISHER_AUTHORITY_QR_TEXT = 'Air Cmde Deepankar Nautiyal';
let assetsPromise: Promise<FinisherPdfAssets> | undefined;

async function fetchAsset(path: string) {
  const base =
    (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env
      ?.BASE_URL || '/';
  const response = await fetch(`${base}assets/certificate/${path}`);
  if (!response.ok)
    throw new Error(
      'The certificate artwork could not be loaded. Please try again.',
    );
  return new Uint8Array(await response.arrayBuffer());
}

export function loadFinisherPdfAssets(): Promise<FinisherPdfAssets> {
  assetsPromise ??= Promise.all([
    fetchAsset('finisher-template.jpg'),
    fetchAsset('NotoSans-Regular.ttf'),
    fetchAsset('NotoSansDevanagari-Regular.ttf'),
  ])
    .then(([templateBytes, latinFontBytes, devanagariFontBytes]) => ({
      templateBytes,
      latinFontBytes,
      devanagariFontBytes,
    }))
    .catch((error: unknown) => {
      assetsPromise = undefined;
      throw error;
    });
  return assetsPromise;
}

export function validateFinisherCertificate(record: FinisherCertificateRecord) {
  const name = record.name.normalize('NFC').trim().replace(/\s+/gu, ' ');
  if (!name || name.length > 100 || !/^[\p{L}\p{M}\s.'’-]+$/u.test(name)) {
    throw new Error(
      'Enter a participant name using letters, spaces and normal name punctuation.',
    );
  }
  if (!['5', '10', '21'].includes(record.race))
    throw new Error('Choose a 5 km, 10 km or 21 km event.');
  if (
    !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/u.test(record.finishTime) ||
    record.finishTime === '00:00:00'
  ) {
    throw new Error('Enter a valid non-zero finish time in HH:MM:SS format.');
  }
  if (!/^[A-Za-z0-9-]{5,80}$/u.test(record.certificateId))
    throw new Error('The certificate number is invalid.');
  if (record.issueDate !== '2026-10-04')
    throw new Error('The certificate issue date must be 04 October 2026.');
  if (record.status && record.status !== 'self-declared')
    throw new Error('Unsupported completion status.');
  if (record.timingSource && record.timingSource !== 'self-reported')
    throw new Error('Unsupported timing source.');
  return { ...record, name };
}

/** Generate a personal, static PDF. User details are text, never rasterised. */
export async function renderFinisherCertificate(
  input: FinisherCertificateRecord,
  suppliedAssets?: FinisherPdfAssets,
): Promise<Uint8Array> {
  const record = validateFinisherCertificate(input);
  const assets = suppliedAssets || (await loadFinisherPdfAssets());
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  const artwork =
    assets.templateBytes[0] === 0xff
      ? await pdf.embedJpg(assets.templateBytes)
      : await pdf.embedPng(assets.templateBytes);
  const printedRatio = assets.templatePrintedHeightRatio ?? 1036 / 1086;
  if (printedRatio <= 0 || printedRatio > 1)
    throw new Error('The certificate artwork dimensions are invalid.');
  page.drawImage(artwork, {
    x: 0,
    y: PAGE_HEIGHT - PAGE_HEIGHT / printedRatio,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT / printedRatio,
  });

  const regular = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const latin = await pdf.embedFont(assets.latinFontBytes, { subset: true });
  const devanagari = await pdf.embedFont(assets.devanagariFontBytes, {
    subset: true,
  });
  const sets = new Map<PDFFont, Set<number>>();
  for (const font of [regular, italic, bold, latin, devanagari])
    sets.set(font, new Set(font.getCharacterSet()));
  const segments = (text: string, preferred: PDFFont) => {
    const fonts = [preferred, latin, devanagari];
    const runs: { text: string; font: PDFFont }[] = [];
    for (const { segment } of new Intl.Segmenter('en', {
      granularity: 'grapheme',
    }).segment(text)) {
      const font = fonts.find((candidate) =>
        Array.from(segment).every((character) =>
          sets.get(candidate)?.has(character.codePointAt(0)!),
        ),
      );
      if (!font)
        throw new Error(
          'The certificate font does not support every character in this name. Please contact the Sports Section.',
        );
      const last = runs[runs.length - 1];
      if (last?.font === font) last.text += segment;
      else runs.push({ text: segment, font });
    }
    return runs;
  };
  const width = (text: string, size: number, font: PDFFont) =>
    segments(text, font).reduce(
      (total, run) => total + run.font.widthOfTextAtSize(run.text, size),
      0,
    );
  const yAt = (sourceY: number) =>
    PAGE_HEIGHT - (sourceY / SOURCE_HEIGHT) * PAGE_HEIGHT;
  const xAt = (sourceX: number) => (sourceX / SOURCE_WIDTH) * PAGE_WIDTH;
  const draw = (
    text: string,
    x: number,
    sourceY: number,
    size: number,
    font = regular,
    color = NAVY,
  ) => {
    for (const run of segments(text, font)) {
      page.drawText(run.text, {
        x,
        y: yAt(sourceY),
        size,
        font: run.font,
        color,
      });
      x += run.font.widthOfTextAtSize(run.text, size);
    }
  };
  const centred = (
    text: string,
    sourceY: number,
    size: number,
    font = regular,
    color = NAVY,
  ) => {
    draw(
      text,
      (PAGE_WIDTH - width(text, size, font)) / 2,
      sourceY,
      size,
      font,
      color,
    );
  };
  const fitted = (
    text: string,
    maxWidth: number,
    preferred: number,
    min: number,
    font: PDFFont,
  ) => {
    let size = preferred;
    while (size > min && width(text, size, font) > maxWidth) size -= 0.25;
    if (width(text, size, font) > maxWidth)
      throw new Error(
        'This participant name does not fit the certificate. Please contact the Sports Section.',
      );
    return size;
  };

  centred('This certifies that', 463, 16, italic);
  const nameSize = fitted(record.name, xAt(860), 24, 13, bold);
  centred(record.name, 510, nameSize, bold);
  centred(
    `has successfully completed the ${record.race} km event`,
    555,
    16,
    italic,
  );
  centred(
    'at Air Force Station Suratgarh on 04 October 2026.',
    596,
    14,
    italic,
  );
  centred(`Self-reported finish time: ${record.finishTime}`, 634, 14, bold);
  centred(
    'Completion and finish time declared by participant.',
    660,
    8,
    regular,
    MUTED,
  );

  const metaX = xAt(162);
  const valueX = xAt(310);
  draw('Certificate No.:', metaX, 700, 10.5);
  draw(
    record.certificateId,
    valueX,
    700,
    fitted(record.certificateId, xAt(500), 12, 8, bold),
    bold,
  );
  draw('Date of issue:', metaX, 736, 10.5);
  draw('04 October 2026', valueX, 736, 12, bold);
  draw('Status:', metaX, 772, 10.5);
  draw('Successful Finisher', valueX, 772, 12, bold);

  // Fill the former signature space above the printed issuing-authority block.
  // Four quiet-zone modules keep the plain-text QR scannable against the artwork.
  const qr = QRCode.create(FINISHER_AUTHORITY_QR_TEXT, {
    errorCorrectionLevel: 'M',
  });
  const qrX = xAt(1138);
  const qrY = yAt(685);
  const qrSide = xAt(106);
  const moduleSize = qrSide / (qr.modules.size + 8);
  page.drawRectangle({
    x: qrX,
    y: qrY,
    width: qrSide,
    height: qrSide,
    color: rgb(1, 1, 1),
  });
  for (let row = 0; row < qr.modules.size; row++) {
    for (let column = 0; column < qr.modules.size; column++) {
      if (!qr.modules.get(row, column)) continue;
      page.drawRectangle({
        x: qrX + (column + 4) * moduleSize,
        y: qrY + (qr.modules.size - row + 3) * moduleSize,
        width: moduleSize,
        height: moduleSize,
        color: rgb(0, 0, 0),
      });
    }
  }
  const qrCaption = 'Authority name QR - not a digital signature';
  draw(
    qrCaption,
    qrX + (qrSide - width(qrCaption, 7, regular)) / 2,
    706,
    7,
    regular,
    MUTED,
  );

  if (assets.preview) {
    const label = 'SAMPLE - NOT FOR ISSUE';
    page.drawText(label, {
      x: (PAGE_WIDTH - bold.widthOfTextAtSize(label, 19)) / 2,
      y: yAt(884),
      size: 19,
      font: bold,
      color: NAVY,
      opacity: 0.35,
    });
  }

  pdf.setTitle(
    `${assets.preview ? 'DESIGN PREVIEW - ' : ''}Sekhon Marathon 2026 - ${record.certificateId}`,
  );
  pdf.setAuthor('Air Force Station Suratgarh');
  pdf.setSubject(
    'Participant-declared successful completion. Finish time is self-reported, not an official race result. The authority-name QR is not a digital signature or verification.',
  );
  pdf.setKeywords([
    'Sekhon Marathon',
    'Suratgarh',
    record.race + ' km',
    'self-reported finish time',
    'participant-declared completion',
  ]);
  pdf.setProducer('Desert Braves certificate download');
  if (record.issuedAt && Number.isFinite(Date.parse(record.issuedAt)))
    pdf.setCreationDate(new Date(record.issuedAt));
  return pdf.save();
}

export function certificateDownloadFilename(
  record: Pick<FinisherCertificateRecord, 'certificateId'>,
) {
  return `Sekhon-Marathon-2026-${record.certificateId.replace(/[^A-Za-z0-9-]/gu, '')}.pdf`;
}

export function finisherPdfObjectUrl(bytes: Uint8Array) {
  // Copy into a plain ArrayBuffer for browser Blob compatibility.
  const data = new Uint8Array(bytes.byteLength);
  data.set(bytes);
  return URL.createObjectURL(
    new Blob([data.buffer], { type: 'application/pdf' }),
  );
}
