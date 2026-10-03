/* eslint-disable next/no-img-element -- This app uses static Vite hosting, not Next image optimisation. */
import { useEffect, useRef, useState, type SyntheticEvent } from 'react';
import {
  ArrowRight,
  Award,
  CheckCircle2,
  Download,
  Eye,
  LoaderCircle,
  Phone,
  RotateCcw,
} from 'lucide-react';
import type { FinisherCertificateRecord } from '@/lib/finisher-pdf';
import {
  certificateFingerprint,
  type CertificateRace,
} from '@/lib/certificate-contract.mjs';

const base = import.meta.env.BASE_URL.replace(/\/$/u, '');
export const CERTIFICATE_SITE =
  'https://sekhonmarathon-suratgarh-2026.netlify.app/';
const endpoint =
  import.meta.env.BASE_URL === '/'
    ? '/.netlify/functions/certificates'
    : `${CERTIFICATE_SITE}.netlify/functions/certificates`;
type CertificateStatus = {
  available: boolean;
  releaseAt: string;
  issueDate: string;
  reason?: string;
};
let cachedStatus: CertificateStatus | null = null;
let cachedAt = 0;
let pendingStatus: Promise<CertificateStatus> | null = null;

async function loadCertificateStatus() {
  const crossedRelease =
    cachedStatus?.reason === 'scheduled' &&
    Date.now() >= Date.parse(cachedStatus.releaseAt);
  if (cachedStatus && !crossedRelease && Date.now() - cachedAt < 300_000)
    return cachedStatus;
  pendingStatus ??= fetch(`${endpoint}?action=status`, { cache: 'no-store' })
    .then(async (response) => {
      if (!response.ok) throw new Error('status');
      const data = (await response.json()) as CertificateStatus;
      if (
        typeof data.available !== 'boolean' ||
        typeof data.releaseAt !== 'string'
      )
        throw new Error('status');
      cachedStatus = data;
      cachedAt = Date.now();
      return data;
    })
    .finally(() => {
      pendingStatus = null;
    });
  return pendingStatus;
}

export function useCertificateStatus() {
  const [status, setStatus] = useState<CertificateStatus | null>(cachedStatus);
  const [statusError, setStatusError] = useState(false);
  const onCertificateHost = import.meta.env.BASE_URL === '/';
  useEffect(() => {
    let active = true;
    async function refresh() {
      try {
        const data = await loadCertificateStatus();
        if (active) {
          setStatus(data);
          setStatusError(false);
        }
      } catch {
        if (active) setStatusError(true);
      }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [onCertificateHost]);
  return { status, statusError, onCertificateHost };
}

export function CertificateFlash({ onOpen }: { onOpen: () => void }) {
  const { status } = useCertificateStatus();
  return (
    <aside className="finisher-flash" aria-label="Finisher certificates">
      <Award size={25} aria-hidden="true" />
      <div>
        <strong>Your run. Your certificate.</strong>
        <span>
          {status?.available
            ? 'Successful finishers — your download is ready.'
            : 'Downloads open 4 October at 10:30 a.m. IST.'}
        </span>
      </div>
      <button onClick={onOpen}>
        Get my certificate <ArrowRight size={17} aria-hidden="true" />
      </button>
    </aside>
  );
}

export function FinisherCertificate() {
  const { status, statusError } = useCertificateStatus();
  const [name, setName] = useState('');
  const [race, setRace] = useState('');
  const [finishTime, setFinishTime] = useState('');
  const [declared, setDeclared] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [record, setRecord] = useState<FinisherCertificateRecord | null>(null);
  const [pdfUrl, setPdfUrl] = useState('');
  const requestIds = useRef(new Map<string, string>());
  const resultHeading = useRef<HTMLHeadingElement>(null);
  useEffect(
    () => () => {
      if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    },
    [pdfUrl],
  );
  useEffect(() => {
    if (record) resultHeading.current?.focus();
  }, [record]);

  async function requestIdFor(payload: {
    name: string;
    race: CertificateRace;
    finishTime: string;
  }) {
    const bytes = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(certificateFingerprint(payload)),
    );
    const fingerprint = Array.from(new Uint8Array(bytes), (byte) =>
      byte.toString(16).padStart(2, '0'),
    ).join('');
    let requestId = requestIds.current.get(fingerprint);
    try {
      requestId ||=
        localStorage.getItem(`desert-braves-certificate-${fingerprint}`) ||
        undefined;
    } catch {
      /* Private browsing can disable storage. */
    }
    requestId ||= crypto.randomUUID();
    requestIds.current.set(fingerprint, requestId);
    try {
      localStorage.setItem(
        `desert-braves-certificate-${fingerprint}`,
        requestId,
      );
    } catch {
      /* In-memory retries still retain the same ID. */
    }
    return requestId;
  }

  async function createCertificate(event: SyntheticEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !status?.available) return;
    setBusy(true);
    setError('');
    try {
      if (race !== '5' && race !== '10' && race !== '21')
        throw new Error('Choose your completed event.');
      if (finishTime === '00:00:00')
        throw new Error('Enter a finish time greater than zero.');
      const payload: {
        name: string;
        race: CertificateRace;
        finishTime: string;
        completionDeclared: boolean;
      } = {
        name: name.trim().replace(/\s+/gu, ' ').normalize('NFC'),
        race,
        finishTime: finishTime.trim(),
        completionDeclared: declared,
      };
      const requestId = await requestIdFor(payload);
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        cache: 'no-store',
        body: JSON.stringify({ ...payload, requestId }),
      });
      if (!response.headers.get('Content-Type')?.includes('application/json'))
        throw new Error(
          'The certificate service is not ready. Please check again shortly.',
        );
      const data = (await response.json()) as FinisherCertificateRecord & {
        message?: string;
        error?: string;
        errors?: Record<string, string>;
      };
      if (!response.ok)
        throw new Error(
          data.message ||
            Object.values(data.errors || {})[0] ||
            data.error ||
            'The certificate could not be created. Please try again.',
        );
      const { renderFinisherCertificate } = await import('@/lib/finisher-pdf');
      const bytes = await renderFinisherCertificate(data);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/pdf' }),
      );
      setPdfUrl(url);
      setRecord(data);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Please try again when your connection is restored.',
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setRecord(null);
    setPdfUrl('');
    setError('');
    setName('');
    setRace('');
    setFinishTime('');
    setDeclared(false);
    document.getElementById('certificate-name')?.focus();
  }

  return (
    <main id="main" className="app-view certificate-view" tabIndex={-1}>
      <header className="certificate-heading">
        <span className="certificate-medallion">
          <Award size={32} aria-hidden="true" />
        </span>
        <p className="app-kicker">
          Desert Braves · Air Force Station Suratgarh
        </p>
        <h1 tabIndex={-1}>Take your achievement home.</h1>
        <p>
          Thank you for being part of the Sekhon Indian Air Force Marathon 2026.
        </p>
      </header>
      <div className="certificate-layout">
        <section className="certificate-card">
          {record ? (
            <div className="certificate-success">
              <CheckCircle2 size={38} aria-hidden="true" />
              <h2 ref={resultHeading} tabIndex={-1}>
                Well run, {record.name}.
              </h2>
              <p>Your {record.race} km certificate is ready.</p>
              <dl>
                <div>
                  <dt>Certificate number</dt>
                  <dd>{record.certificateId}</dd>
                </div>
                <div>
                  <dt>Self-reported finish time</dt>
                  <dd>{record.finishTime}</dd>
                </div>
                <div>
                  <dt>Date of issue</dt>
                  <dd>04 October 2026</dd>
                </div>
              </dl>
              <a
                className="certificate-primary"
                href={pdfUrl}
                download={`Sekhon-2026-${record.race}km-${record.certificateId}.pdf`}
              >
                <Download size={19} /> Download certificate
              </a>
              <a
                className="certificate-secondary"
                href={pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Eye size={18} /> Open PDF preview
              </a>
              <p className="certificate-note">
                On iPhone, open the PDF and choose Share → Save to Files.
              </p>
              <button className="certificate-text-action" onClick={reset}>
                <RotateCcw size={16} /> Create another participant’s certificate
              </button>
            </div>
          ) : (
            <>
              <h2>Your finish-line details</h2>
              <p className="certificate-note">
                Enter your name exactly as you want it printed.
              </p>
              {!status?.available && (
                <output className="certificate-availability">
                  {statusError
                    ? 'The certificate service is being prepared. Planned opening: 4 October at 10:30 a.m. IST, once activated by the organisers. Please check again shortly.'
                    : status?.reason === 'disabled' ||
                        status?.reason === 'template_not_ready'
                      ? 'Certificate downloads are awaiting release by the organisers. Please check again shortly.'
                      : status
                        ? 'Downloads open on 4 October 2026 at 10:30 a.m. IST, once released by the organisers.'
                        : 'Checking certificate availability…'}
                </output>
              )}
              <form onSubmit={(event) => void createCertificate(event)}>
                <label htmlFor="certificate-name">Participant name</label>
                <input
                  id="certificate-name"
                  name="participantName"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  required
                  maxLength={80}
                  autoComplete="name"
                  placeholder="Full name"
                  disabled={busy}
                />
                <label htmlFor="certificate-race">Event completed</label>
                <select
                  id="certificate-race"
                  value={race}
                  onChange={(event) => setRace(event.target.value)}
                  required
                  disabled={busy}
                >
                  <option value="">Choose your distance</option>
                  <option value="5">5 km · Fun Run</option>
                  <option value="10">10 km · Challenge Run</option>
                  <option value="21">21 km · Half Marathon</option>
                </select>
                <label htmlFor="certificate-time">
                  Your finish time <small>Self-reported</small>
                </label>
                <input
                  id="certificate-time"
                  name="finishTime"
                  value={finishTime}
                  onChange={(event) => {
                    const digits = event.target.value
                      .replace(/\D/gu, '')
                      .slice(0, 6);
                    setFinishTime(
                      digits.length <= 2
                        ? digits
                        : digits.length <= 4
                          ? `${digits.slice(0, 2)}:${digits.slice(2)}`
                          : `${digits.slice(0, 2)}:${digits.slice(2, 4)}:${digits.slice(4)}`,
                    );
                  }}
                  required
                  inputMode="numeric"
                  pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"
                  maxLength={8}
                  placeholder="HH:MM:SS"
                  aria-describedby="certificate-time-help"
                  disabled={busy}
                />
                <p id="certificate-time-help" className="certificate-note">
                  Type six digits: 004530 becomes 00:45:30 (45 minutes, 30
                  seconds).
                </p>
                <label className="certificate-declaration">
                  <input
                    type="checkbox"
                    checked={declared}
                    onChange={(event) => setDeclared(event.target.checked)}
                    required
                    disabled={busy}
                  />
                  <span>
                    I participated in and completed this event. My name,
                    distance and self-reported finish time are correct.
                  </span>
                </label>
                <p className="certificate-note certificate-provenance">
                  This certificate records participant-declared completion and
                  timing; it is not an official timed result.
                </p>
                {error && (
                  <p className="certificate-error" role="alert">
                    {error}
                  </p>
                )}
                <button
                  className="certificate-primary"
                  type="submit"
                  disabled={busy || !status?.available}
                >
                  {busy ? (
                    <LoaderCircle className="certificate-spinner" size={19} />
                  ) : (
                    <Award size={19} />
                  )}
                  {busy
                    ? 'Preparing your certificate…'
                    : 'Create my certificate'}
                </button>
                <p className="certificate-privacy">
                  Your name, race and self-reported time are saved privately to
                  issue your certificate. No phone number or email is required.
                </p>
              </form>
            </>
          )}
        </section>
        <aside className="certificate-art">
          <img
            src={`${base}/assets/certificate/finisher-template.jpg`}
            width="1448"
            height="1036"
            alt="Sekhon Marathon certificate design with a tricolour border, runners and Air Force Station Suratgarh title"
          />
          <h2>One run. A lasting memory.</h2>
          <p>Run · Soar · Inspire</p>
          <p className="certificate-note">Date of issue: 04 October 2026</p>
          <a href="tel:+918838463776">
            <Phone size={16} /> Sports Section: 88384 63776
          </a>
          <a href="tel:+917027964880">
            <Phone size={16} /> 70279 64880
          </a>
        </aside>
      </div>
    </main>
  );
}
