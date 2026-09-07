/**
 * Standalone-friendly private organiser mirror for the Desert Braves register.
 *
 * Set these Script Properties before running syncParticipantsToDrive:
 * SPREADSHEET_ID, RECEIPTS_FOLDER_ID, SUPABASE_DRIVE_ENDPOINT,
 * DRIVE_MIRROR_HMAC_SECRET. Keep the Sheet and receipts folder private.
 *
 * This script imports from the registration service only. It never publishes
 * payment decisions or changes any registration data in the event platform.
 */

const BACKEND_HEADERS_ = [
  'Registration ID', 'Registered at', 'Full name', 'Mobile', 'Email',
  'Date of birth', 'Gender', 'Eligibility', 'City', 'Race (km)', 'Fee (₹)',
  'T-shirt requested', 'Blood group', 'Emergency contact', 'Payment reference',
  'Payment status', 'Payment reviewed at', 'Payment attempt ID',
  'Payment attempt status', 'Payment attempt revision', 'Source revision',
  'Receipt file',
];

// These fields are maintained by the organiser on the private Sheet. Syncs
// never overwrite them, even when a payment status changes in the backend.
const LOCAL_HEADERS_ = [
  'T-shirt issued', 'T-shirt issued size', 'T-shirt issued at',
  'T-shirt desk note', 'Finish confirmed', 'Medal issued', 'Distribution date',
];

const HMAC_AUDIENCE_ = 'drive-register';

const HEADER_ALIASES_ = {
  'Registered at': ['Registration date'],
  'Race (km)': ['Race'],
  'Fee (₹)': ['Fee'],
  'T-shirt requested': ['T-shirt', 'T-shirt size'],
  'Payment reference': ['Transaction ID', 'Transaction reference', 'UTR'],
  'Payment reviewed at': ['Reviewed at'],
  'Payment attempt ID': ['Attempt ID'],
  'Payment attempt status': ['Attempt status'],
  'Payment attempt revision': ['Attempt revision'],
  'Receipt file': ['Receipt', 'Receipt URL'],
};

function settings_() {
  const properties = PropertiesService.getScriptProperties().getProperties();
  const required = [
    'SPREADSHEET_ID', 'RECEIPTS_FOLDER_ID', 'SUPABASE_DRIVE_ENDPOINT',
    'DRIVE_MIRROR_HMAC_SECRET',
  ];
  required.forEach(key => {
    if (!properties[key]) throw new Error('Set the ' + key + ' Script Property first.');
  });
  if (String(properties.DRIVE_MIRROR_HMAC_SECRET).length < 32) {
    throw new Error('DRIVE_MIRROR_HMAC_SECRET must be at least 32 characters.');
  }
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/functions\/v1\/drive-register$/.test(
    properties.SUPABASE_DRIVE_ENDPOINT,
  )) {
    throw new Error('Use the Supabase drive-register function URL.');
  }
  return properties;
}

function hmacHex_(secret, message) {
  return Utilities.computeHmacSha256Signature(message, secret)
    .map(byte => {
      const unsigned = byte < 0 ? byte + 256 : byte;
      return ('0' + unsigned.toString(16)).slice(-2);
    })
    .join('');
}

function request_(properties, payload) {
  const raw = JSON.stringify(payload);
  if (Utilities.newBlob(raw).getBytes().length > 8192) {
    throw new Error('The private mirror request is too large.');
  }
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = Utilities.getUuid();
  const signedMessage = [
    'POST', HMAC_AUDIENCE_, timestamp, nonce, raw,
  ].join('\n');
  const signature = hmacHex_(properties.DRIVE_MIRROR_HMAC_SECRET, signedMessage);
  const response = UrlFetchApp.fetch(properties.SUPABASE_DRIVE_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Drive-Mirror-Timestamp': timestamp,
      'X-Drive-Mirror-Nonce': nonce,
      'X-Drive-Mirror-Signature': signature,
    },
    payload: raw,
    muteHttpExceptions: true,
  });
  let body;
  try {
    body = JSON.parse(response.getContentText());
  } catch (_) {
    throw new Error('The registration service returned an invalid response.');
  }
  if (response.getResponseCode() >= 400) {
    throw new Error(body.error || 'The registration service is unavailable.');
  }
  return body;
}

function assertPrivate_(fileOrFolder, label) {
  if (fileOrFolder.getSharingAccess() !== DriveApp.Access.PRIVATE) {
    throw new Error(label + ' must be private. Remove link-wide sharing before syncing.');
  }
}

function openPrivateMirror_(properties) {
  const spreadsheetFile = DriveApp.getFileById(properties.SPREADSHEET_ID);
  const folder = DriveApp.getFolderById(properties.RECEIPTS_FOLDER_ID);
  assertPrivate_(spreadsheetFile, 'The organiser register');
  assertPrivate_(folder, 'The receipts folder');
  const book = SpreadsheetApp.openById(properties.SPREADSHEET_ID);
  let sheet = book.getSheetByName('Participants');
  if (!sheet) sheet = book.insertSheet('Participants');
  return {book: book, folder: folder, sheet: sheet};
}

function headerPosition_(headers, expected) {
  const candidates = [expected].concat(HEADER_ALIASES_[expected] || []);
  for (let index = 0; index < candidates.length; index += 1) {
    const position = headers.indexOf(candidates[index]);
    if (position >= 0) return position;
  }
  return -1;
}

function ensureRegisterHeaders_(sheet) {
  const initialWidth = Math.max(sheet.getLastColumn(), 1);
  let headers = sheet.getRange(1, 1, 1, initialWidth).getDisplayValues()[0]
    .map(value => String(value).trim());
  const required = BACKEND_HEADERS_.concat(LOCAL_HEADERS_);
  let changed = false;

  if (headers.every(value => !value)) {
    headers = required.slice();
    changed = true;
  } else if (headers[0] !== 'Registration ID') {
    throw new Error('Participants!A1 must be "Registration ID" before it can be synced.');
  }

  required.forEach(header => {
    if (headerPosition_(headers, header) < 0) {
      headers.push(header);
      changed = true;
    }
  });
  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }
  if (changed) sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  const columns = {};
  required.forEach(header => {
    columns[header] = headerPosition_(headers, header);
  });
  columns.width = headers.length;
  return columns;
}

function safeText_(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /^[=+\-@\t\r\n]/.test(text) ? "'" + text : text;
}

function dateValue_(value) {
  if (!value) return '';
  const date = new Date(value);
  return isNaN(date.getTime()) ? safeText_(value) : date;
}

function asInteger_(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : fallback;
}

function knownRows_(sheet) {
  const lastRow = sheet.getLastRow();
  const rows = new Map();
  if (lastRow < 2) return rows;
  sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().forEach((row, index) => {
    const registrationId = String(row[0] || '').trim();
    if (registrationId) rows.set(registrationId, index + 2);
  });
  return rows;
}

function privateReceipt_(properties, folder, registrationId, paymentAttemptId, receiptAvailable) {
  if (!receiptAvailable) return '';
  if (!/^[0-9a-f-]{36}$/i.test(paymentAttemptId)) {
    throw new Error('The registration service returned an invalid payment attempt reference.');
  }
  // Each proof gets a different private Drive file. A corrected payment updates
  // the sheet to its current proof while the prior rejected proof remains in
  // the private folder for the organiser audit trail.
  const name = registrationId + '.' + paymentAttemptId + '.receipt';
  const existing = folder.getFilesByName(name);
  if (existing.hasNext()) {
    const file = existing.next();
    assertPrivate_(file, 'The copied receipt');
    return file.getUrl();
  }

  const signed = request_(properties, {action: 'receipt', payment_attempt_id: paymentAttemptId});
  const origin = properties.SUPABASE_DRIVE_ENDPOINT
    .replace('/functions/v1/drive-register', '');
  if (typeof signed.signed_url !== 'string'
      || signed.signed_url.indexOf(origin + '/storage/v1/') !== 0) {
    throw new Error('The registration service returned an unexpected receipt URL.');
  }
  const response = UrlFetchApp.fetch(signed.signed_url, {muteHttpExceptions: true});
  if (response.getResponseCode() !== 200) {
    throw new Error('The private receipt could not be downloaded. Run the sync again.');
  }
  const blob = response.getBlob();
  if (!['image/jpeg', 'image/png'].includes(blob.getContentType())
      || blob.getBytes().length > 5242880) {
    throw new Error('The private receipt has an unexpected type or size.');
  }
  const copied = folder.createFile(blob.setName(name));
  assertPrivate_(copied, 'The copied receipt');
  return copied.getUrl();
}

function recordValues_(record, receiptUrl) {
  const gender = {
    male: 'Male', female: 'Female', other: 'Other', prefer_not_to_say: 'Prefer not to say',
  }[record.gender] || record.gender;
  const eligibility = record.participant_type === 'family' ? 'Family member' : 'Air warrior';
  return {
    'Registration ID': safeText_(record.registration_id),
    'Registered at': dateValue_(record.registered_at),
    'Full name': safeText_(record.full_name),
    'Mobile': safeText_(record.mobile),
    'Email': safeText_(record.email),
    'Date of birth': safeText_(record.dob),
    'Gender': safeText_(gender),
    'Eligibility': safeText_(eligibility),
    'City': safeText_(record.city),
    'Race (km)': safeText_(record.race),
    'Fee (₹)': Number(record.fee_paise) / 100,
    'T-shirt requested': safeText_(record.tshirt),
    'Blood group': safeText_(record.blood_group),
    'Emergency contact': safeText_(record.emergency_contact),
    'Payment reference': safeText_(record.transaction_utr),
    'Payment status': safeText_(record.payment_status),
    'Payment reviewed at': dateValue_(record.payment_reviewed_at),
    'Payment attempt ID': safeText_(record.payment_attempt_id),
    'Payment attempt status': safeText_(record.payment_attempt_status),
    'Payment attempt revision': asInteger_(record.payment_attempt_revision, ''),
    'Source revision': asInteger_(record.source_revision, ''),
    'Receipt file': safeText_(receiptUrl),
  };
}

function writeRecord_(sheet, rowNumber, columns, record, receiptUrl) {
  const row = rowNumber <= sheet.getLastRow()
    ? sheet.getRange(rowNumber, 1, 1, columns.width).getValues()[0]
    : Array(columns.width).fill('');
  const values = recordValues_(record, receiptUrl);
  Object.keys(values).forEach(header => {
    row[columns[header]] = values[header];
  });
  sheet.getRange(rowNumber, 1, 1, columns.width).setValues([row]);
  ['Registration ID', 'Mobile', 'Emergency contact', 'Payment reference', 'Payment attempt ID']
    .forEach(header => sheet.getRange(rowNumber, columns[header] + 1).setNumberFormat('@'));
  sheet.getRange(rowNumber, columns['Fee (₹)'] + 1).setNumberFormat('₹#,##0.00');
}

function validatePage_(page, cursor) {
  if (!page || !Array.isArray(page.records) || typeof page.has_more !== 'boolean') {
    throw new Error('The registration service returned an invalid mirror page.');
  }
  const next = asInteger_(page.next_after_source_revision, -1);
  if (next < cursor) throw new Error('The registration service returned a stale mirror cursor.');
  return next;
}

/** Run manually from the Apps Script editor or by the installed time trigger. */
function syncParticipantsToDrive() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return 'A private mirror sync is already running.';
  try {
    const started = Date.now();
    const properties = settings_();
    const mirror = openPrivateMirror_(properties);
    const columns = ensureRegisterHeaders_(mirror.sheet);
    const rows = knownRows_(mirror.sheet);
    const scriptProperties = PropertiesService.getScriptProperties();
    let cursor = asInteger_(scriptProperties.getProperty('DRIVE_MIRROR_AFTER_SOURCE_REVISION'), 0);
    let nextRow = Math.max(2, mirror.sheet.getLastRow() + 1);
    let imported = 0;
    let updated = 0;

    do {
      const page = request_(properties, {
        action: 'sync', after_source_revision: cursor, limit: 50,
      });
      const nextCursor = validatePage_(page, cursor);
      let highest = cursor;
      page.records.forEach(record => {
        const registrationId = String(record.registration_id || '').trim();
        const paymentAttemptId = String(record.payment_attempt_id || '').trim();
        const sourceRevision = asInteger_(record.source_revision, 0);
        if (!/^[0-9a-f-]{36}$/i.test(registrationId)
            || !/^[0-9a-f-]{36}$/i.test(paymentAttemptId)
            || sourceRevision <= highest) {
          throw new Error('The registration service returned an invalid mirror record.');
        }
        const existingRow = rows.get(registrationId);
        const rowNumber = existingRow || nextRow;
        const currentReceipt = existingRow
          ? mirror.sheet.getRange(rowNumber, columns['Receipt file'] + 1).getDisplayValue()
          : '';
        const currentAttemptId = existingRow
          ? mirror.sheet.getRange(rowNumber, columns['Payment attempt ID'] + 1).getDisplayValue().trim()
          : '';
        const receiptUrl = currentAttemptId === paymentAttemptId && currentReceipt
          ? currentReceipt
          : privateReceipt_(
            properties, mirror.folder, registrationId, paymentAttemptId,
            record.receipt_available === true,
          );
        writeRecord_(mirror.sheet, rowNumber, columns, record, receiptUrl);
        if (existingRow) updated += 1;
        else {
          rows.set(registrationId, rowNumber);
          nextRow += 1;
          imported += 1;
        }
        highest = sourceRevision;
      });
      if (highest !== nextCursor && page.records.length > 0) {
        throw new Error('The registration service returned an inconsistent mirror cursor.');
      }
      cursor = nextCursor;
      scriptProperties.setProperty('DRIVE_MIRROR_AFTER_SOURCE_REVISION', String(cursor));
      SpreadsheetApp.flush();
      if (!page.has_more || Date.now() - started > 280000) break;
      if (page.records.length === 0) throw new Error('The mirror cursor did not advance.');
    } while (true);

    scriptProperties.setProperty('DRIVE_MIRROR_LAST_SYNC_AT', new Date().toISOString());
    return 'Private mirror complete: ' + imported + ' new, ' + updated + ' updated.';
  } finally {
    lock.releaseLock();
  }
}

/** Creates or verifies the private Participants register headers without importing data. */
function createMirrorHeaders() {
  const properties = settings_();
  const mirror = openPrivateMirror_(properties);
  ensureRegisterHeaders_(mirror.sheet);
  return 'Private organiser register headers are ready.';
}

/** Installs a ten-minute private import trigger. Run once from the script editor. */
function enableAutomaticImports() {
  settings_();
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncParticipantsToDrive')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('syncParticipantsToDrive').timeBased().everyMinutes(10).create();
  return 'Private mirror imports are scheduled every 10 minutes.';
}

function disableAutomaticImports() {
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'syncParticipantsToDrive')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return 'Private mirror imports are disabled.';
}
