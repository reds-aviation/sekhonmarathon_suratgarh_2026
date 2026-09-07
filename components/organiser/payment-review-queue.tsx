'use client';

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ComponentProps,
} from 'react';
import {
  CheckCircle2,
  ExternalLink,
  FileImage,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  OrganiserMfaSetup,
  type OrganiserMfaAssurance,
} from './mfa-setup';
import './payment-review-queue.css';

type PaymentStatus = 'pending_review' | 'verified' | 'rejected' | 'all';
type RaceFilter = 'all' | '5' | '10' | '21';
type QueueAccess = 'unknown' | 'allowed' | 'denied';

type PaymentQueueItem = {
  payment_attempt_id: string;
  registration_id: string;
  full_name: string;
  race: '5' | '10' | '21';
  attempt_ordinal: number;
  expected_fee_paise: number;
  transaction_utr: string | null;
  status: Exclude<PaymentStatus, 'all'>;
  submitted_at: string;
  attempt_revision: number;
  source_revision: number;
  receipt_available: boolean;
};

type PaymentQueueResponse = {
  items: PaymentQueueItem[];
  next_after_source_revision: number | null;
  has_more: boolean;
};

type ReviewIntent = {
  attemptId: string;
  status: 'verified' | 'rejected';
  note: string;
  requestId: string;
};

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<'form'>['onSubmit']>
>[0];

const defaultEventId = 'suratgarh-2026';
const money = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});
const submittedAt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
});
const statusCopy: Record<Exclude<PaymentStatus, 'all'>, string> = {
  pending_review: 'Awaiting review',
  verified: 'Verified',
  rejected: 'Needs correction',
};

function readQueueResponse(value: unknown): PaymentQueueResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('The payment queue returned an unexpected response.');
  }

  const queue = value as Partial<PaymentQueueResponse>;
  if (!Array.isArray(queue.items) || typeof queue.has_more !== 'boolean') {
    throw new Error('The payment queue returned an unexpected response.');
  }

  return {
    items: queue.items as PaymentQueueItem[],
    next_after_source_revision:
      typeof queue.next_after_source_revision === 'number'
        ? queue.next_after_source_revision
        : null,
    has_more: queue.has_more,
  };
}

function readProofUrl(value: unknown): string {
  if (!value || typeof value !== 'object') {
    throw new Error('The screenshot link could not be prepared.');
  }

  const response = value as Record<string, unknown>;
  const candidate = response.signed_url ?? response.signedUrl ?? response.url;
  if (typeof candidate !== 'string') {
    throw new Error('The screenshot link could not be prepared.');
  }

  try {
    const url = new URL(candidate);
    if (url.protocol !== 'https:') throw new Error('Unsafe screenshot link');
    return url.toString();
  } catch {
    throw new Error('The screenshot link could not be prepared.');
  }
}

function newRequestId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  const values = new Uint8Array(16);
  crypto.getRandomValues(values);
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;
  const hex = [...values].map((value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function plainError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Please try again or contact an event administrator.';
}

function queueError(error: unknown) {
  const message = plainError(error);
  if (/capability|permission|organis|aal|verified email|not authorized/i.test(message)) {
    return 'This signed-in account does not have payment-review access. Organiser access requires a verified email, multi-factor sign-in, and an assigned role.';
  }
  return message;
}

function isAccessError(error: unknown) {
  return /capability|permission|organis|aal|verified email|not authorized/i.test(
    plainError(error),
  );
}

function rowKey(item: PaymentQueueItem) {
  return `${item.payment_attempt_id}:${item.attempt_revision}`;
}

export function OrganiserPaymentReviewQueue({
  eventId = defaultEventId,
  pageSize = 25,
}: {
  eventId?: string;
  pageSize?: number;
}) {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInMessage, setSignInMessage] = useState('');
  const [mfaAssurance, setMfaAssurance] = useState<OrganiserMfaAssurance>('unknown');
  const [access, setAccess] = useState<QueueAccess>('unknown');
  const [statusFilter, setStatusFilter] = useState<PaymentStatus>('pending_review');
  const [raceFilter, setRaceFilter] = useState<RaceFilter>('all');
  const [items, setItems] = useState<PaymentQueueItem[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueErrorMessage, setQueueErrorMessage] = useState('');
  const [selected, setSelected] = useState<PaymentQueueItem | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [proofBusy, setProofBusy] = useState('');
  const [proofUrl, setProofUrl] = useState<string | null>(null);
  const [message, setMessage] = useState('');

  const requestCounter = useRef(0);
  const nextCursorRef = useRef<number | null>(null);
  const reviewRequests = useRef(new Map<string, ReviewIntent>());
  const emailId = useId();
  const rejectNoteId = useId();

  const loadQueue = useCallback(
    async ({ append = false }: { append?: boolean } = {}) => {
      if (!supabase || !user || mfaAssurance !== 'aal2') return false;

      const request = requestCounter.current + 1;
      requestCounter.current = request;
      setQueueLoading(true);
      setQueueErrorMessage('');

      const { data, error } = await supabase.rpc('payment_review_queue', {
        p_event_id: eventId,
        p_status: statusFilter,
        p_race: raceFilter === 'all' ? null : raceFilter,
        p_after_source_revision: append ? nextCursorRef.current : null,
        p_limit: pageSize,
      });

      if (request !== requestCounter.current) return false;
      setQueueLoading(false);

      if (error) {
        if (isAccessError(error)) setAccess('denied');
        setQueueErrorMessage(queueError(error));
        return false;
      }

      try {
        const queue = readQueueResponse(data);
        setAccess('allowed');
        setItems((current) => (append ? [...current, ...queue.items] : queue.items));
        nextCursorRef.current = queue.next_after_source_revision;
        setHasMore(queue.has_more);
        return true;
      } catch (failure) {
        setQueueErrorMessage(plainError(failure));
        return false;
      }
    },
    [eventId, mfaAssurance, pageSize, raceFilter, statusFilter, user],
  );

  useEffect(() => {
    if (!supabase) return;
    let alive = true;

    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) setQueueErrorMessage(plainError(error));
        setUser(data.session?.user ?? null);
        setAuthLoading(false);
      })
      .catch((error: unknown) => {
        if (!alive) return;
        setQueueErrorMessage(plainError(error));
        setAuthLoading(false);
      });

    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!alive) return;
      requestCounter.current += 1;
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setMfaAssurance('unknown');
      setAccess('unknown');
      setItems([]);
      setSelected(null);
      setProofUrl(null);
      setQueueErrorMessage('');
      setQueueLoading(false);
    });

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authLoading || !user || mfaAssurance !== 'aal2') return;
    const scheduled = window.setTimeout(() => {
      void loadQueue();
    }, 0);
    return () => window.clearTimeout(scheduled);
  }, [authLoading, loadQueue, mfaAssurance, raceFilter, statusFilter, user]);

  const handleMfaAssurance = useCallback((assurance: OrganiserMfaAssurance) => {
    setMfaAssurance(assurance);
    if (assurance === 'aal2') return;

    requestCounter.current += 1;
    setAccess('unknown');
    setItems([]);
    setHasMore(false);
    setSelected(null);
    setProofUrl(null);
    setQueueErrorMessage('');
    setQueueLoading(false);
  }, []);

  const requestSignIn = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!supabase || !email.trim()) return;

    setSignInBusy(true);
    setSignInMessage('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSignInBusy(false);
    setSignInMessage(
      error
        ? plainError(error)
        : 'Check your email for the secure sign-in link, then return to this desk.',
    );
  };

  async function signOut() {
    if (!supabase) return;
    setQueueLoading(true);
    const { error } = await supabase.auth.signOut();
    setQueueLoading(false);
    if (error) setQueueErrorMessage(plainError(error));
  }

  function selectAttempt(item: PaymentQueueItem) {
    setSelected(item);
    setReviewNote('');
    setProofUrl(null);
    setMessage('');
  }

  async function prepareProof(item: PaymentQueueItem) {
    if (!supabase || !item.receipt_available) return;
    setProofBusy(item.payment_attempt_id);
    setProofUrl(null);
    setMessage('');

    const { data, error } = await supabase.functions.invoke(
      'organiser-payment-proof',
      {
        body: {
          payment_attempt_id: item.payment_attempt_id,
          request_id: newRequestId(),
        },
      },
    );
    setProofBusy('');

    if (error) {
      setMessage(plainError(error));
      return;
    }

    try {
      setProofUrl(readProofUrl(data));
    } catch (failure) {
      setMessage(plainError(failure));
    }
  }

  async function review(status: 'verified' | 'rejected') {
    if (!supabase || !selected) return;
    const note = reviewNote.trim();
    if (status === 'rejected' && note.length < 5) {
      setMessage('Give the participant a short reason for the correction needed.');
      return;
    }

    const key = `${selected.payment_attempt_id}:${status}:${note}`;
    const previous = reviewRequests.current.get(key);
    const intent =
      previous ?? {
        attemptId: selected.payment_attempt_id,
        status,
        note,
        requestId: newRequestId(),
      };
    reviewRequests.current.set(key, intent);

    setReviewBusy(true);
    setMessage('');
    const { error } = await supabase.rpc('review_payment_attempt', {
      p_event_id: eventId,
      p_attempt_id: intent.attemptId,
      p_expected_attempt_revision: selected.attempt_revision,
      p_status: intent.status,
      p_note: intent.note,
      p_request_id: intent.requestId,
    });
    setReviewBusy(false);

    if (error) {
      setMessage(plainError(error));
      return;
    }

    reviewRequests.current.delete(key);
    setSelected(null);
    setReviewNote('');
    setProofUrl(null);
    setMessage(
      status === 'verified'
        ? 'Payment verified. The queue has been refreshed.'
        : 'The correction request has been sent. The queue has been refreshed.',
    );
    const refreshed = await loadQueue();
    if (!refreshed) {
      setMessage('The payment decision was saved. Refresh the queue before reviewing another entry.');
    }
  }

  const selectedKey = selected ? rowKey(selected) : '';
  const noConfiguration = !supabase;

  return (
    <section className="payment-review-desk" aria-labelledby="payment-review-title">
      <header className="payment-review-desk__header">
        <div>
          <span className="payment-review-desk__eyebrow">Organiser desk</span>
          <h2 id="payment-review-title">Payment review</h2>
          <p>
            Review one submitted payment at a time. Screenshots are private and
            links expire shortly after they are opened.
          </p>
        </div>
        {user && (
          <button className="payment-review-desk__signout" type="button" onClick={signOut}>
            <LogOut aria-hidden="true" size={16} />
            Sign out
          </button>
        )}
      </header>

      <p className="payment-review-desk__live" aria-live="polite">
        {message || signInMessage}
      </p>

      {noConfiguration ? (
        <div className="payment-review-desk__notice" aria-live="polite">
          <ShieldCheck aria-hidden="true" size={21} />
          <div>
            <strong>Secure organiser access is not configured in this build.</strong>
            <p>Set the Supabase publishable configuration in the private Netlify app.</p>
          </div>
        </div>
      ) : authLoading ? (
        <div className="payment-review-desk__loading" aria-live="polite">
          <LoaderCircle aria-hidden="true" className="payment-review-desk__spin" size={20} />
          Checking secure access…
        </div>
      ) : !user ? (
        <form className="payment-review-desk__signin" onSubmit={requestSignIn}>
          <ShieldCheck aria-hidden="true" size={26} />
          <div>
            <h3>Sign in to the organiser desk</h3>
            <p>Use the verified email that has been assigned an organiser role.</p>
          </div>
          <label htmlFor={emailId}>Organiser email</label>
          <div className="payment-review-desk__signin-row">
            <input
              id={emailId}
              autoComplete="email"
              inputMode="email"
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@example.com"
              required
              type="email"
              value={email}
            />
            <button disabled={signInBusy} type="submit">
              {signInBusy ? 'Sending…' : 'Send secure link'}
            </button>
          </div>
          <small>Multi-factor sign-in is required before payment data can be viewed.</small>
        </form>
      ) : (
        <>
          <div className="payment-review-desk__identity">
            <ShieldCheck aria-hidden="true" size={19} />
            <span>Signed in as <strong>{user.email || 'organiser account'}</strong></span>
            <span className={`payment-review-desk__access payment-review-desk__access--${access}`}>
              {mfaAssurance !== 'aal2'
                ? 'Multi-factor sign-in required'
                : access === 'allowed'
                  ? 'Payment reviewer access'
                  : 'Checking access'}
            </span>
          </div>

          <OrganiserMfaSetup
            key={user.id}
            onAssuranceChange={handleMfaAssurance}
            userId={user.id}
          />

          {mfaAssurance === 'aal2' && <>
          <div className="payment-review-desk__filters" aria-label="Payment queue filters">
            <label>
              <span>Status</span>
              <select
                onChange={(event) => setStatusFilter(event.target.value as PaymentStatus)}
                value={statusFilter}
              >
                <option value="pending_review">Awaiting review</option>
                <option value="verified">Verified</option>
                <option value="rejected">Needs correction</option>
                <option value="all">All payment reviews</option>
              </select>
            </label>
            <label>
              <span>Race</span>
              <select
                onChange={(event) => setRaceFilter(event.target.value as RaceFilter)}
                value={raceFilter}
              >
                <option value="all">All distances</option>
                <option value="5">5 KM</option>
                <option value="10">10 KM</option>
                <option value="21">21 KM</option>
              </select>
            </label>
            <button
              className="payment-review-desk__refresh"
              disabled={queueLoading}
              onClick={() => void loadQueue()}
              type="button"
            >
              <RefreshCw
                aria-hidden="true"
                className={queueLoading ? 'payment-review-desk__spin' : ''}
                size={17}
              />
              Refresh
            </button>
          </div>

          {queueErrorMessage && (
            <div className="payment-review-desk__error" role="alert">
              <XCircle aria-hidden="true" size={19} />
              <span>{queueErrorMessage}</span>
            </div>
          )}

          <div className="payment-review-desk__queue" aria-busy={queueLoading}>
            <div className="payment-review-desk__queue-head" aria-hidden="true">
              <span>Participant</span>
              <span>Race</span>
              <span>Expected</span>
              <span>UTR</span>
              <span>Submitted</span>
              <span>Status</span>
              <span />
            </div>
            {items.map((item) => {
              const active = selectedKey === rowKey(item);
              return (
                <article
                  className={`payment-review-desk__row${active ? ' is-selected' : ''}`}
                  key={rowKey(item)}
                >
                  <div className="payment-review-desk__person">
                    <strong>{item.full_name}</strong>
                    <small>Attempt {item.attempt_ordinal} · revision {item.attempt_revision}</small>
                  </div>
                  <div data-label="Race"><strong>{item.race} KM</strong></div>
                  <div data-label="Expected">{money.format(item.expected_fee_paise / 100)}</div>
                  <div data-label="UTR" className="payment-review-desk__utr">
                    {item.transaction_utr || 'Not provided'}
                  </div>
                  <div data-label="Submitted">{submittedAt.format(new Date(item.submitted_at))}</div>
                  <div data-label="Status">
                    <span className={`payment-review-desk__status payment-review-desk__status--${item.status}`}>
                      {statusCopy[item.status]}
                    </span>
                  </div>
                  <div className="payment-review-desk__row-action">
                    <button onClick={() => selectAttempt(item)} type="button">
                      {active ? 'Reviewing' : 'Review'}
                    </button>
                  </div>

                  {active && selected && (
                    <div className="payment-review-desk__review" id={`review-${selected.payment_attempt_id}`}>
                      <div className="payment-review-desk__review-head">
                        <div>
                          <span>Review payment evidence</span>
                          <strong>{selected.full_name} · {selected.race} KM</strong>
                        </div>
                        <button
                          className="payment-review-desk__close"
                          onClick={() => {
                            setSelected(null);
                            setProofUrl(null);
                            setReviewNote('');
                          }}
                          type="button"
                        >
                          Close
                        </button>
                      </div>

                      <div className="payment-review-desk__proof">
                        <FileImage aria-hidden="true" size={20} />
                        <div>
                          <strong>Payment screenshot</strong>
                          <p>Open only to cross-check the expected amount and UTR.</p>
                        </div>
                        {selected.receipt_available ? (
                          <button
                            disabled={proofBusy === selected.payment_attempt_id}
                            onClick={() => void prepareProof(selected)}
                            type="button"
                          >
                            {proofBusy === selected.payment_attempt_id ? 'Preparing…' : 'Prepare screenshot'}
                          </button>
                        ) : (
                          <span className="payment-review-desk__unavailable">Screenshot unavailable</span>
                        )}
                      </div>

                      {proofUrl && (
                        <a
                          className="payment-review-desk__proof-link"
                          href={proofUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Open time-limited screenshot <ExternalLink aria-hidden="true" size={16} />
                        </a>
                      )}

                      <label className="payment-review-desk__note" htmlFor={rejectNoteId}>
                        <span>Message for the participant <em>Required when asking for a correction</em></span>
                        <textarea
                          id={rejectNoteId}
                          maxLength={1000}
                          onChange={(event) => setReviewNote(event.target.value)}
                          placeholder="Example: The UTR shown in the screenshot does not match the one entered."
                          value={reviewNote}
                        />
                      </label>

                      <div className="payment-review-desk__review-actions">
                        <button
                          className="payment-review-desk__reject"
                          disabled={reviewBusy}
                          onClick={() => void review('rejected')}
                          type="button"
                        >
                          <XCircle aria-hidden="true" size={17} />
                          Ask for correction
                        </button>
                        <button
                          className="payment-review-desk__verify"
                          disabled={reviewBusy}
                          onClick={() => void review('verified')}
                          type="button"
                        >
                          {reviewBusy ? (
                            <LoaderCircle aria-hidden="true" className="payment-review-desk__spin" size={17} />
                          ) : (
                            <CheckCircle2 aria-hidden="true" size={17} />
                          )}
                          Verify payment
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {!queueLoading && !queueErrorMessage && items.length === 0 && (
            <div className="payment-review-desk__empty" aria-live="polite">
              <CheckCircle2 aria-hidden="true" size={23} />
              <div>
                <strong>No matching payment reviews</strong>
                <p>Change a filter or return when another payment is submitted.</p>
              </div>
            </div>
          )}

          {hasMore && (
            <button
              className="payment-review-desk__more"
              disabled={queueLoading}
              onClick={() => void loadQueue({ append: true })}
              type="button"
            >
              {queueLoading ? 'Loading…' : 'Load more payments'}
            </button>
          )}
          </>}
        </>
      )}
    </section>
  );
}
