'use client';

import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  ArrowRight,
  Download,
  FileCheck2,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  ShieldCheck,
  UploadCloud,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import { supabase } from '@/lib/supabase';
import { MemberRouteTimeline } from '@/components/member-route-timeline';
import {
  formatFinishTime,
  parseFinishTime,
  TIMING_LABELS,
  type RaceDistance,
  type TimingProvenance,
} from '@/lib/event-day';
import type { User } from '@supabase/supabase-js';
import './event-portal.css';

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<'form'>['onSubmit']>
>[0];

type Result = {
  elapsed_seconds: number;
  provenance: TimingProvenance;
  status: string;
  note: string;
  certificate_hold: boolean;
};

type Entry = {
  id: string;
  registration_number: string | null;
  full_name: string;
  race: RaceDistance;
  payment_status: string;
  tshirt: string;
  result: Result | null;
};

type Snapshot = {
  server_now: string;
  self_submission_open: boolean;
  certificates_configured: boolean;
  registrations: Entry[];
};

type PortalView = 'participant' | 'organiser' | 'verify';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resultLabels: Record<string, string> = {
  participant_submitted: 'Time submitted',
  organiser_recorded: 'Recorded by finish official',
  organiser_verified: 'Verified',
  organiser_corrected: 'Corrected by organiser',
  verified: 'Verified',
  correction_required: 'Correction required',
  locked: 'Result locked',
};

function ContactHelp() {
  return (
    <span>
      Organiser help: <a href="tel:+918838463776">88384 63776</a> /{' '}
      <a href="tel:+917027964880">70279 64880</a>
    </span>
  );
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

export function EventPortal({
  onClose,
  initialView = 'participant',
  onViewChange,
  onOpenOrganiser,
}: {
  onClose?: () => void;
  initialView?: PortalView;
  onViewChange?: (view: PortalView) => void;
  onOpenOrganiser: () => void;
}) {
  const [view, setView] = useState<PortalView>(initialView);
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [selected, setSelected] = useState('');
  const [time, setTime] = useState('');
  const [reviewing, setReviewing] = useState(false);
  const [download, setDownload] = useState<{ url: string; number: string } | null>(
    null,
  );
  const [correctionTransactionId, setCorrectionTransactionId] = useState('');
  const [correctionReceipt, setCorrectionReceipt] = useState<File | null>(null);
  const [correctionBusy, setCorrectionBusy] = useState(false);
  const [correctionError, setCorrectionError] = useState('');
  const [verificationToken, setVerificationToken] = useState(
    () => new URLSearchParams(window.location.search).get('certificate') || '',
  );
  const [verification, setVerification] = useState<Record<string, unknown> | null>(
    null,
  );

  const correctionRequestId = useRef<string | null>(null);
  const snapshotRequest = useRef(0);
  const snapshotUser = useRef<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const activeEntry = snapshot?.registrations.find((entry) => entry.id === selected);

  function changeView(next: PortalView) {
    if (next === view) return;
    setView(next);
    onViewChange?.(next);
  }

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active) return;
        setUser(data.session?.user ?? null);
        setAuthLoading(false);
      })
      .catch(() => {
        if (active) setAuthLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setAuthLoading(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!error) return undefined;
    const frame = requestAnimationFrame(() => errorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [error]);

  async function refresh() {
    if (!supabase || !user) return null;
    const request = snapshotRequest.current + 1;
    snapshotRequest.current = request;
    const { data, error: failure } = await supabase.rpc('event_day', {
      p_action: 'snapshot',
      p_payload: {},
    });
    if (snapshotUser.current !== user.id || request !== snapshotRequest.current) {
      return null;
    }
    if (failure) {
      setError(
        'The event portal could not load. Its backend setup may still be pending; please retry or contact the organising team.',
      );
      return null;
    }
    setSnapshot(data as Snapshot);
    return data as Snapshot;
  }

  useEffect(() => {
    snapshotUser.current = user?.id ?? null;
    snapshotRequest.current += 1;
    setSnapshot(null);
    setSelected('');
    setDownload(null);
    correctionRequestId.current = null;
    if (!user) return undefined;
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [user]);

  useEffect(() => {
    setTime(
      activeEntry?.result
        ? formatFinishTime(activeEntry.result.elapsed_seconds)
        : '',
    );
    setReviewing(false);
    setDownload(null);
    correctionRequestId.current = null;
    setCorrectionTransactionId('');
    setCorrectionReceipt(null);
    setCorrectionError('');
  }, [selected]);

  async function signIn(event: FormSubmitEvent) {
    event.preventDefault();
    if (!supabase) return;
    setBusy('auth');
    setError('');
    try {
      if (sent) {
        const { error: failure } = await supabase.auth.verifyOtp({
          email: email.trim().toLowerCase(),
          token: otp.trim(),
          type: 'email',
        });
        if (failure) throw failure;
        setSent(false);
        setOtp('');
      } else {
        const { error: failure } = await supabase.auth.signInWithOtp({
          email: email.trim().toLowerCase(),
          options: { shouldCreateUser: false },
        });
        if (failure) throw failure;
        setSent(true);
        setMessage('Check the inbox used for your registration.');
      }
    } catch {
      setError(
        sent
          ? 'That code is invalid or expired. Request a new code.'
          : 'We could not send a code. Use your registered email or contact an organiser.',
      );
    } finally {
      setBusy('');
    }
  }

  function selectCorrectionReceipt(file: File | undefined) {
    correctionRequestId.current = null;
    setCorrectionError('');
    if (!file) {
      setCorrectionReceipt(null);
      return;
    }
    if (
      !['image/jpeg', 'image/png'].includes(file.type) ||
      file.size === 0 ||
      file.size > 5 * 1024 * 1024
    ) {
      setCorrectionReceipt(null);
      setCorrectionError('Choose a JPG or PNG screenshot, no larger than 5 MB.');
      return;
    }
    setCorrectionReceipt(file);
  }

  async function submitPaymentCorrection(event: FormSubmitEvent) {
    event.preventDefault();
    if (!supabase || !activeEntry || !correctionReceipt) return;
    const transactionId = correctionTransactionId.trim();
    if (!/^[A-Za-z0-9-]{6,64}$/.test(transactionId)) {
      setCorrectionError('Enter the payment reference shown in your UPI app.');
      return;
    }

    const requestId = correctionRequestId.current || crypto.randomUUID();
    correctionRequestId.current = requestId;
    setCorrectionBusy(true);
    setCorrectionError('');
    try {
      const body = new FormData();
      body.set(
        'payload',
        JSON.stringify({
          event_id: 'suratgarh-2026',
          registration_id: activeEntry.id,
          correction_id: requestId,
          transaction_id: transactionId,
        }),
      );
      body.set('receipt', correctionReceipt);
      const { data, error: failure } = await supabase.functions.invoke(
        'correct-payment',
        { body },
      );
      if (failure) {
        let detail =
          'We could not save the replacement proof. Please retry without making another payment.';
        try {
          const response = await failure.context?.json();
          if (response?.error) detail = response.error;
        } catch {}
        throw new Error(detail);
      }
      if (data?.payment_status !== 'pending_review') {
        throw new Error(
          'The replacement proof could not be confirmed. Please retry without making another payment.',
        );
      }
      setMessage(
        'Replacement payment proof received. It is now awaiting organiser verification.',
      );
      correctionRequestId.current = null;
      setCorrectionTransactionId('');
      setCorrectionReceipt(null);
      await refresh();
    } catch (failure) {
      setCorrectionError(
        messageFor(
          failure,
          'We could not save the replacement proof. Please retry.',
        ),
      );
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function submitSelfTime(entry: Entry) {
    if (!supabase) return;
    let elapsedSeconds: number;
    try {
      elapsedSeconds = parseFinishTime(time);
    } catch (failure) {
      setError(messageFor(failure, 'Use HH:MM:SS for your finish time.'));
      return;
    }
    if (!reviewing) {
      setReviewing(true);
      return;
    }

    setBusy('self_time');
    setError('');
    setMessage('');
    try {
      const { data, error: failure } = await supabase.rpc('event_day', {
        p_action: 'self_time',
        p_payload: {
          registration_id: entry.id,
          elapsed_seconds: elapsedSeconds,
        },
      });
      if (failure) throw failure;
      if (!data) throw new Error('Your finish time could not be saved.');
      await refresh();
      setReviewing(false);
      setMessage(
        'Your finish time is saved as self-reported. Prize decisions require an organiser-verified result.',
      );
      if (snapshot?.certificates_configured) await certificate(entry);
    } catch (failure) {
      setError(messageFor(failure, 'Your finish time could not be saved.'));
    } finally {
      setBusy('');
    }
  }

  async function certificate(entry: Entry) {
    if (!supabase) return;
    setBusy('certificate');
    setError('');
    try {
      const { data, error: failure } = await supabase.functions.invoke(
        'certificate',
        { body: { registration_id: entry.id, kind: 'completion' } },
      );
      if (failure) {
        let description =
          'Certificate generation is awaiting approved setup or organiser release.';
        try {
          const detail = await failure.context?.json();
          if (detail?.error) description = detail.error;
        } catch {}
        throw new Error(description);
      }
      setDownload({ url: data.download_url, number: data.certificate_number });
      await refresh();
    } catch (failure) {
      setError(messageFor(failure, 'Certificate could not be prepared.'));
    } finally {
      setBusy('');
    }
  }

  async function verify(event?: FormSubmitEvent) {
    event?.preventDefault();
    if (!supabase) return;
    if (!uuid.test(verificationToken.trim())) {
      setError('Enter the verification token from the certificate QR link.');
      return;
    }
    setBusy('verify');
    setError('');
    const { data, error: failure } = await supabase.rpc('verify_certificate', {
      p_token: verificationToken.trim(),
    });
    setBusy('');
    if (failure) setError('Certificate verification is currently unavailable.');
    else setVerification(data);
  }

  useEffect(() => {
    if (initialView === 'verify' && uuid.test(verificationToken) && supabase) {
      void verify();
    }
  }, []);

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose?.();
      }}
    >
      <DialogContent className="event-portal" showCloseButton={Boolean(onClose)}>
        <div className="portal-header">
          <span className="portal-eyebrow">DESERT BRAVES · SURATGARH</span>
          <DialogTitle>
            {view === 'verify'
              ? 'Certificate verification'
              : view === 'organiser'
                ? 'Organiser desks'
                : 'My entry'}
          </DialogTitle>
          <DialogDescription>
            Your entry, finish time and certificate.
          </DialogDescription>
        </div>
        <nav className="portal-tabs" aria-label="Portal sections">
          <button
            aria-current={view === 'participant' ? 'page' : undefined}
            onClick={() => changeView('participant')}
            type="button"
          >
            My event
          </button>
          <button
            aria-current={view === 'organiser' ? 'page' : undefined}
            onClick={onOpenOrganiser}
            type="button"
          >
            Organiser
          </button>
          <button
            aria-current={view === 'verify' ? 'page' : undefined}
            onClick={() => changeView('verify')}
            type="button"
          >
            Verify certificate
          </button>
        </nav>

        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="portal-error">
            {error}
          </p>
        )}
        {message && <p role="status" className="portal-message">{message}</p>}

        {!supabase ? (
          <div className="portal-notice">
            <LockKeyhole />
            <h3>
              {view === 'verify'
                ? 'Certificate verification is not available yet'
                : 'Your entry will appear here.'}
            </h3>
            <p>
              {view === 'verify'
                ? 'Verification will be available when certificates are issued. Scan the QR on your certificate to check its details.'
                : 'Registration has not opened yet. Your entries and results will appear here when available.'}
            </p>
          </div>
        ) : view === 'verify' ? (
          <section className="portal-panel">
            <h3>Verify a certificate</h3>
            <p>
              Scan the certificate’s QR or paste its verification token below.
              No sign-in is needed.
            </p>
            <form className="portal-form" onSubmit={verify}>
              <label>
                Verification token
                <input
                  autoCapitalize="none"
                  onChange={(event) => setVerificationToken(event.target.value)}
                  placeholder="Token from the certificate QR link"
                  required
                  spellCheck={false}
                  value={verificationToken}
                />
              </label>
              <button className="portal-button" disabled={Boolean(busy)}>
                Verify certificate <ShieldCheck size={17} />
              </button>
            </form>
            {verification && (
              <div className="portal-verification">
                <h4>
                  {verification.status === 'valid'
                    ? 'Certificate valid'
                    : verification.status === 'revoked'
                      ? 'Certificate revoked'
                      : verification.status === 'not_ready'
                        ? 'Certificate not issued yet'
                        : 'Certificate not found'}
                </h4>
                {!!verification.certificate_number && (
                  <>
                    <p>
                      {String(verification.participant_name)} ·{' '}
                      {String(verification.race)} KM
                    </p>
                    <p>
                      {String(verification.certificate_number)} ·{' '}
                      {String(verification.event_date)}
                    </p>
                    <p>
                      {String(verification.kind)} certificate ·{' '}
                      {formatFinishTime(Number(verification.elapsed_seconds))}
                    </p>
                    <small>
                      {TIMING_LABELS[
                        verification.timing_provenance as TimingProvenance
                      ]}{' '}
                      · Approved visual signature
                    </small>
                  </>
                )}
              </div>
            )}
          </section>
        ) : authLoading ? (
          <p className="portal-notice">Checking your sign-in…</p>
        ) : !user ? (
          <section className="portal-panel">
            <h3>Welcome back</h3>
            <p>Use the email entered during registration.</p>
            <form className="portal-form" onSubmit={signIn}>
              <label>
                Email address
                <input
                  autoComplete="email"
                  inputMode="email"
                  onChange={(event) => setEmail(event.target.value)}
                  readOnly={sent}
                  required
                  type="email"
                  value={email}
                />
              </label>
              {sent && (
                <label>
                  Email sign-in code
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    onChange={(event) => setOtp(event.target.value)}
                    pattern="[0-9]{6,10}"
                    required
                    value={otp}
                  />
                </label>
              )}
              <button className="portal-button" disabled={Boolean(busy)}>
                {sent ? 'Verify email' : 'Send sign-in code'} <ArrowRight size={17} />
              </button>
              {sent && (
                <button
                  className="portal-link"
                  onClick={() => {
                    setSent(false);
                    setOtp('');
                  }}
                  type="button"
                >
                  Change email / request another code
                </button>
              )}
            </form>
          </section>
        ) : view === 'organiser' ? (
          <section className="portal-panel">
            <h3>Open the organiser desks</h3>
            <p>
              Payment review, T-shirt collection and race completion are available
              in the protected organiser workspace.
            </p>
            <button
              className="portal-button"
              onClick={onOpenOrganiser}
              type="button"
            >
              Open organiser desks <ArrowRight size={17} />
            </button>
          </section>
        ) : !snapshot ? (
          <p className="portal-notice">
            {error
              ? 'Portal data is unavailable. Your existing registration is unchanged.'
              : 'Loading your event…'}
          </p>
        ) : (
          <>
            <div className="portal-account">
              <span>{user.email}</span>
              <button
                className="portal-link"
                disabled={Boolean(busy)}
                onClick={async () => {
                  await supabase?.auth.signOut();
                  setUser(null);
                }}
                type="button"
              >
                Sign out
              </button>
              <button
                className="portal-link"
                disabled={Boolean(busy)}
                onClick={() => void refresh()}
                type="button"
              >
                <RefreshCw size={15} /> Refresh
              </button>
            </div>
            <MemberRouteTimeline />
            <section className="portal-panel">
              <h3>My registrations</h3>
              {snapshot.registrations.length === 0 ? (
                <p>
                  No registrations are linked to this email. Use the email entered
                  during registration.
                </p>
              ) : (
                <>
                  <label>
                    Choose your participant
                    <select
                      onChange={(event) => setSelected(event.target.value)}
                      value={selected}
                    >
                      <option value="">Choose registration / participant</option>
                      {snapshot.registrations.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.registration_number || 'Pending payment'} ·{' '}
                          {entry.full_name} · {entry.race} KM
                        </option>
                      ))}
                    </select>
                  </label>
                  {activeEntry && (
                    <div className="portal-participant">
                      <h4>{activeEntry.full_name}</h4>
                      <p>
                        {activeEntry.registration_number ||
                          'Registration ID is assigned after payment confirmation'}{' '}
                        · {activeEntry.race} KM
                      </p>
                      <p className="portal-status">
                        {activeEntry.payment_status === 'verified'
                          ? 'Registration confirmed'
                          : activeEntry.payment_status === 'rejected'
                            ? 'Payment needs a corrected proof'
                            : 'Payment verification pending'}
                      </p>

                      {activeEntry.payment_status === 'rejected' && (
                        <form
                          className="portal-form portal-payment-correction"
                          onSubmit={(event) => void submitPaymentCorrection(event)}
                        >
                          <h4>Update payment proof</h4>
                          <p>
                            Submit a corrected UPI reference and a new payment
                            screenshot. Your original proof stays on record.
                          </p>
                          <label>
                            New UPI payment reference
                            <input
                              autoComplete="off"
                              disabled={correctionBusy}
                              inputMode="text"
                              maxLength={64}
                              onChange={(event) => {
                                correctionRequestId.current = null;
                                setCorrectionTransactionId(event.target.value);
                              }}
                              placeholder="Reference from your UPI app"
                              required
                              value={correctionTransactionId}
                            />
                          </label>
                          <label className="portal-payment-upload">
                            <UploadCloud size={22} />
                            <span>
                              {correctionReceipt
                                ? correctionReceipt.name
                                : 'Add a new payment screenshot'}
                            </span>
                            <small>JPG or PNG · maximum 5 MB</small>
                            <input
                              accept="image/jpeg,image/png"
                              disabled={correctionBusy}
                              onChange={(event) =>
                                selectCorrectionReceipt(event.target.files?.[0])
                              }
                              required
                              type="file"
                            />
                          </label>
                          {correctionError && (
                            <p className="portal-error" role="alert">
                              {correctionError}
                            </p>
                          )}
                          <p className="portal-payment-correction-note">
                            Do not make another payment just to retry this form.
                          </p>
                          <button
                            className="portal-button"
                            disabled={correctionBusy || !correctionReceipt}
                          >
                            Submit replacement proof{' '}
                            {correctionBusy ? (
                              <LoaderCircle className="spin" size={17} />
                            ) : (
                              <ArrowRight size={17} />
                            )}
                          </button>
                        </form>
                      )}

                      {activeEntry.result && (
                        <div className="portal-result">
                          <strong>
                            {formatFinishTime(activeEntry.result.elapsed_seconds)}
                          </strong>
                          <span>
                            {TIMING_LABELS[activeEntry.result.provenance]} ·{' '}
                            {resultLabels[activeEntry.result.status]}
                          </span>
                          {activeEntry.result.note && (
                            <p>{activeEntry.result.note}</p>
                          )}
                        </div>
                      )}

                      {activeEntry.payment_status === 'verified' &&
                        (!activeEntry.result ||
                          (activeEntry.result.status === 'correction_required' &&
                            activeEntry.result.provenance ===
                              'participant_submitted')) && (
                          <form
                            className="portal-form"
                            onSubmit={(event) => {
                              event.preventDefault();
                              void submitSelfTime(activeEntry);
                            }}
                          >
                            <label>
                              My finish time · HH:MM:SS
                              <input
                                disabled={!snapshot.self_submission_open}
                                inputMode="numeric"
                                onChange={(event) => {
                                  setTime(event.target.value);
                                  setReviewing(false);
                                }}
                                placeholder="00:42:18"
                                required
                                value={time}
                              />
                            </label>
                            {!snapshot.self_submission_open ? (
                              <p>Finish-time submission has not opened.</p>
                            ) : reviewing ? (
                              <p className="portal-notice">
                                Confirm {time} for {activeEntry.full_name},{' '}
                                {activeEntry.race} KM. This is a self-reported
                                time; changes after submission need organiser review.
                              </p>
                            ) : (
                              <p>
                                Enter the elapsed time you saw on the race clock or
                                were told by a finish official.
                              </p>
                            )}
                            <button
                              className="portal-button"
                              disabled={Boolean(busy) || !snapshot.self_submission_open}
                            >
                              {reviewing
                                ? 'Confirm my finish time'
                                : 'Review finish time'}{' '}
                              <ArrowRight size={17} />
                            </button>
                          </form>
                        )}

                      {activeEntry.result && (
                        <div className="portal-certificate">
                          <h4>
                            <FileCheck2 size={18} /> Completion certificate
                          </h4>
                          {activeEntry.result.certificate_hold ||
                          activeEntry.result.status === 'correction_required' ? (
                            <p>Your certificate awaits organiser review.</p>
                          ) : !snapshot.certificates_configured ? (
                            <p>
                              Your result is saved. Certificates will be available
                              after the approved signature and certificate setup are
                              ready.
                            </p>
                          ) : (
                            <button
                              className="portal-button"
                              disabled={Boolean(busy)}
                              onClick={() => void certificate(activeEntry)}
                              type="button"
                            >
                              Prepare / download certificate <Download size={17} />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </section>
          </>
        )}

        {download && (
          <div className="portal-message">
            <b>{download.number} is ready.</b>{' '}
            <a href={download.url} rel="noopener noreferrer" target="_blank">
              Download PDF
            </a>
            <small>
              This private link expires after two minutes. Prepare it again if it
              expires.
            </small>
          </div>
        )}
        <div className="portal-footer">
          <ContactHelp />
          {onClose && (
            <button className="portal-link" onClick={onClose} type="button">
              Return to event
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
