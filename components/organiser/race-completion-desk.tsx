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
  CircleAlert,
  ClipboardCheck,
  LoaderCircle,
  LogOut,
  RefreshCw,
  ShieldCheck,
  Timer,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  formatFinishTime,
  parseFinishTime,
  type TimingProvenance,
} from '@/lib/event-day';
import {
  OrganiserMfaSetup,
  type OrganiserMfaAssurance,
} from './mfa-setup';
import './race-completion-desk.css';

type RaceFilter = 'all' | '5' | '10' | '21';
type QueueFilter = 'all' | 'unrecorded' | 'recorded' | 'review' | 'locked';
type ResultStatus =
  | 'organiser_recorded'
  | 'participant_submitted'
  | 'verified'
  | 'correction_required'
  | 'locked';
type ReviewStatus = 'verified' | 'correction_required' | 'locked';
type DeskAccess = 'unknown' | 'allowed' | 'denied';

type CompletionQueueItem = {
  registration_id: string;
  registration_number: string | null;
  full_name: string;
  race: Exclude<RaceFilter, 'all'>;
  elapsed_seconds: number | null;
  result_provenance: TimingProvenance | null;
  result_status: ResultStatus | null;
  result_revision: number;
  certificate_hold: boolean;
};

type CompletionQueueResponse = {
  items: CompletionQueueItem[];
  next_after_registration_id: string | null;
  has_more: boolean;
  can_review_results: boolean;
};

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<'form'>['onSubmit']>
>[0];

const defaultEventId = 'suratgarh-2026';
const resultLabels: Record<ResultStatus, string> = {
  organiser_recorded: 'Finish recorded',
  participant_submitted: 'Self-reported time',
  verified: 'Result verified',
  correction_required: 'Correction required',
  locked: 'Result locked',
};

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

function accessError(error: unknown) {
  return /capability|permission|organis|aal|verified email|not authorized/i.test(
    plainError(error),
  );
}

function deskError(error: unknown) {
  const message = plainError(error);
  if (accessError(error)) {
    return 'This account does not have completion-desk access. Use a verified email, complete multi-factor sign-in, and ask an event administrator to assign the appropriate role.';
  }
  if (/completion desk is not enabled/i.test(message)) {
    return 'Race-day completion controls have not been enabled for this event.';
  }
  return message;
}

function readQueue(value: unknown): CompletionQueueResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('The completion queue returned an unexpected response.');
  }

  const queue = value as Partial<CompletionQueueResponse>;
  if (!Array.isArray(queue.items) || typeof queue.has_more !== 'boolean') {
    throw new Error('The completion queue returned an unexpected response.');
  }

  return {
    items: queue.items as CompletionQueueItem[],
    next_after_registration_id:
      typeof queue.next_after_registration_id === 'string'
        ? queue.next_after_registration_id
        : null,
    has_more: queue.has_more,
    // Fail closed if an older backend response is ever cached during rollout.
    can_review_results: queue.can_review_results === true,
  };
}

function rowKey(item: CompletionQueueItem) {
  return `${item.registration_id}:${item.result_revision}`;
}

function isRecordable(item: CompletionQueueItem) {
  return (
    item.result_status === null ||
    item.result_status === 'participant_submitted' ||
    item.result_status === 'correction_required'
  );
}

function matchesFilter(item: CompletionQueueItem, filter: QueueFilter) {
  if (filter === 'all') return true;
  if (filter === 'unrecorded') return item.result_status === null;
  if (filter === 'recorded') return item.result_status === 'organiser_recorded';
  if (filter === 'review') {
    return (
      item.result_status === 'participant_submitted' ||
      item.result_status === 'correction_required'
    );
  }
  return item.result_status === 'locked';
}

export function OrganiserRaceCompletionDesk({
  eventId = defaultEventId,
  pageSize = 25,
}: {
  eventId?: string;
  pageSize?: number;
}) {
  const emailId = useId();
  const finishTimeId = useId();
  const reviewNoteId = useId();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInMessage, setSignInMessage] = useState('');
  const [mfaAssurance, setMfaAssurance] =
    useState<OrganiserMfaAssurance>('unknown');
  const [access, setAccess] = useState<DeskAccess>('unknown');
  const [raceFilter, setRaceFilter] = useState<RaceFilter>('all');
  const [queueFilter, setQueueFilter] = useState<QueueFilter>('unrecorded');
  const [items, setItems] = useState<CompletionQueueItem[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [canReviewResults, setCanReviewResults] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<
    string | null
  >(null);
  const [finishTime, setFinishTime] = useState('');
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>('verified');
  const [reviewNote, setReviewNote] = useState('');
  const [certificateHold, setCertificateHold] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  const queueRequest = useRef(0);
  const actionRequests = useRef(new Map<string, string>());
  const selected =
    items.find((item) => item.registration_id === selectedRegistrationId) ?? null;
  const visibleItems = items.filter((item) => matchesFilter(item, queueFilter));

  const loadQueue = useCallback(
    async ({ append = false }: { append?: boolean } = {}) => {
      if (!supabase || !user || mfaAssurance !== 'aal2') return false;
      if (append && !nextAfter) return false;

      const request = queueRequest.current + 1;
      queueRequest.current = request;
      setQueueLoading(true);
      setQueueError('');
      try {
        const { data, error } = await supabase.rpc('completion_desk_queue', {
          p_event_id: eventId,
          p_race: raceFilter === 'all' ? null : raceFilter,
          p_after_registration_id: append ? nextAfter : null,
          p_limit: pageSize,
        });
        if (request !== queueRequest.current) return false;
        if (error) throw error;

        const queue = readQueue(data);
        setAccess('allowed');
        setCanReviewResults(queue.can_review_results);
        setItems((current) =>
          append ? [...current, ...queue.items] : queue.items,
        );
        setNextAfter(queue.next_after_registration_id);
        setHasMore(queue.has_more);
        if (!append) setSelectedRegistrationId(null);
        return true;
      } catch (error) {
        if (request !== queueRequest.current) return false;
        if (accessError(error)) setAccess('denied');
        setCanReviewResults(false);
        setQueueError(deskError(error));
        if (!append) {
          setItems([]);
          setNextAfter(null);
          setHasMore(false);
          setCanReviewResults(false);
          setSelectedRegistrationId(null);
        }
        return false;
      } finally {
        if (request === queueRequest.current) setQueueLoading(false);
      }
    },
    [eventId, mfaAssurance, nextAfter, pageSize, raceFilter, user],
  );

  useEffect(() => {
    if (!supabase) return undefined;

    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setQueueError(plainError(error));
        setUser(data.session?.user ?? null);
        setAuthLoading(false);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setQueueError(plainError(error));
        setAuthLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      queueRequest.current += 1;
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setMfaAssurance('unknown');
      setAccess('unknown');
      setItems([]);
      setNextAfter(null);
      setHasMore(false);
      setCanReviewResults(false);
      setSelectedRegistrationId(null);
      setQueueError('');
      setActionBusy(false);
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (authLoading || !user || mfaAssurance !== 'aal2') return;
    const timer = window.setTimeout(() => void loadQueue(), 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, loadQueue, mfaAssurance, user]);

  const handleMfaAssurance = useCallback((assurance: OrganiserMfaAssurance) => {
    setMfaAssurance(assurance);
    if (assurance === 'aal2') return;

    queueRequest.current += 1;
    setAccess('unknown');
    setItems([]);
    setNextAfter(null);
    setHasMore(false);
    setCanReviewResults(false);
    setSelectedRegistrationId(null);
    setQueueError('');
    setQueueLoading(false);
  }, []);

  const requestSignIn = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setSignInBusy(true);
    setSignInMessage('');
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {
        emailRedirectTo: window.location.origin,
        shouldCreateUser: false,
      },
    });
    setSignInBusy(false);
    setSignInMessage(
      error
        ? plainError(error)
        : 'Check your email for the secure sign-in link, then complete multi-factor sign-in.',
    );
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setLiveMessage('Signed out.');
  };

  const openCompletion = (item: CompletionQueueItem) => {
    setSelectedRegistrationId(item.registration_id);
    setFinishTime(
      item.elapsed_seconds === null ? '' : formatFinishTime(item.elapsed_seconds),
    );
    setReviewStatus('verified');
    setReviewNote('');
    setCertificateHold(item.certificate_hold);
    setQueueError('');
    setLiveMessage('');
  };

  const requestIdFor = (key: string) => {
    const prior = actionRequests.current.get(key);
    if (prior) return prior;
    const requestId = newRequestId();
    actionRequests.current.set(key, requestId);
    return requestId;
  };

  const recordCompletion = async () => {
    if (!supabase || !selected || actionBusy) return;
    let elapsedSeconds: number;
    try {
      elapsedSeconds = parseFinishTime(finishTime);
    } catch (error) {
      setQueueError(plainError(error));
      return;
    }

    const requestId = requestIdFor(
      `record:${selected.registration_id}:${selected.result_revision}:${elapsedSeconds}`,
    );
    setActionBusy(true);
    setQueueError('');
    try {
      const { data, error } = await supabase.rpc('record_race_completion', {
        p_event_id: eventId,
        p_registration_id: selected.registration_id,
        p_elapsed_seconds: elapsedSeconds,
        p_expected_result_revision: selected.result_revision,
        p_request_id: requestId,
      });
      if (error) throw error;
      const outcome = data as { elapsed_seconds?: number } | null;
      setSelectedRegistrationId(null);
      setLiveMessage(
        outcome?.elapsed_seconds
          ? `Finish recorded at ${formatFinishTime(outcome.elapsed_seconds)}. An event administrator can review it if needed.`
          : 'Finish recorded. An event administrator can review it if needed.',
      );
      await loadQueue();
    } catch (error) {
      if (accessError(error)) setAccess('denied');
      setQueueError(deskError(error));
    } finally {
      setActionBusy(false);
    }
  };

  const reviewCompletion = async () => {
    if (!supabase || !selected || actionBusy) return;
    if (!canReviewResults) {
      setQueueError(
        'Result decisions require active event administrator access. You can still record finishes assigned to this desk.',
      );
      return;
    }
    const note = reviewNote.trim();
    if (note.length < 5) {
      setQueueError('Add a short reason before saving this result decision.');
      return;
    }

    let elapsedSeconds: number;
    try {
      elapsedSeconds = parseFinishTime(finishTime);
    } catch (error) {
      setQueueError(plainError(error));
      return;
    }

    const requestId = requestIdFor(
      `review:${selected.registration_id}:${selected.result_revision}:${reviewStatus}:${elapsedSeconds}:${certificateHold}:${note}`,
    );
    setActionBusy(true);
    setQueueError('');
    try {
      const { data, error } = await supabase.rpc('review_race_completion', {
        p_event_id: eventId,
        p_registration_id: selected.registration_id,
        p_expected_result_revision: selected.result_revision,
        p_target_status: reviewStatus,
        p_elapsed_seconds: elapsedSeconds,
        p_note: note,
        p_certificate_hold: certificateHold,
        p_request_id: requestId,
      });
      if (error) throw error;
      const outcome = data as { status?: string } | null;
      setSelectedRegistrationId(null);
      setLiveMessage(
        outcome?.status === 'locked'
          ? 'Result locked.'
          : 'Result decision saved. The completion queue has been refreshed.',
      );
      await loadQueue();
    } catch (error) {
      if (accessError(error)) {
        setQueueError(
          'Result decisions require active event administrator access. Finish recording remains available to this desk.',
        );
      } else {
        setQueueError(deskError(error));
      }
    } finally {
      setActionBusy(false);
    }
  };

  if (!supabase) {
    return (
      <section
        className="race-completion-desk"
        aria-labelledby="race-completion-desk-title"
      >
        <header className="race-completion-desk__header">
          <div>
            <span className="race-completion-desk__eyebrow">Organiser only</span>
            <h2 id="race-completion-desk-title">Completion desk</h2>
          </div>
        </header>
        <div className="race-completion-desk__notice" aria-live="polite">
          <ShieldCheck aria-hidden="true" size={22} />
          <div>
            <strong>The secure completion desk is not configured.</strong>
            <p>Connect the private application before organiser accounts can open the completion queue.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className="race-completion-desk"
      aria-labelledby="race-completion-desk-title"
    >
      <header className="race-completion-desk__header">
        <div>
          <span className="race-completion-desk__eyebrow">Organiser only</span>
          <h2 id="race-completion-desk-title">Completion desk</h2>
          <p>
            Record official finish times one runner at a time. The queue is limited
            to confirmed entrants and never includes contact or payment evidence.
          </p>
        </div>
        {user && (
          <button
            className="race-completion-desk__signout"
            onClick={() => void signOut()}
            type="button"
          >
            <LogOut aria-hidden="true" size={16} />
            Sign out
          </button>
        )}
      </header>

      {authLoading ? (
        <output className="race-completion-desk__loading" aria-live="polite">
          <LoaderCircle
            aria-hidden="true"
            className="race-completion-desk__spin"
            size={19}
          />
          Checking secure sign-in…
        </output>
      ) : !user ? (
        <form className="race-completion-desk__signin" onSubmit={requestSignIn}>
          <ClipboardCheck aria-hidden="true" size={26} />
          <div>
            <h3>Open the organiser desk</h3>
            <p>
              Use the verified email assigned to the finish team. Multi-factor
              sign-in and a completion role are required.
            </p>
          </div>
          <label htmlFor={emailId}>Organiser email</label>
          <div className="race-completion-desk__signin-row">
            <input
              autoComplete="email"
              id={emailId}
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
          {signInMessage && <output>{signInMessage}</output>}
        </form>
      ) : (
        <>
          <div className="race-completion-desk__identity">
            <ShieldCheck aria-hidden="true" size={19} />
            <span>
              Signed in as <strong>{user.email ?? 'organiser account'}</strong>
            </span>
            <span
              className={`race-completion-desk__access race-completion-desk__access--${access}`}
            >
              {mfaAssurance !== 'aal2'
                ? 'Multi-factor sign-in required'
                : access === 'allowed'
                  ? 'Completion-desk access'
                  : 'Checking access'}
            </span>
          </div>

          <OrganiserMfaSetup
            key={user.id}
            onAssuranceChange={handleMfaAssurance}
            userId={user.id}
          />

          {mfaAssurance === 'aal2' && (
            <>
              <div
                className="race-completion-desk__filters"
                aria-label="Completion queue filters"
              >
                <label>
                  Distance
                  <select
                    onChange={(event) =>
                      setRaceFilter(event.target.value as RaceFilter)
                    }
                    value={raceFilter}
                  >
                    <option value="all">All distances</option>
                    <option value="5">5 KM</option>
                    <option value="10">10 KM</option>
                    <option value="21">21 KM</option>
                  </select>
                </label>
                <label>
                  Result state
                  <select
                    onChange={(event) =>
                      setQueueFilter(event.target.value as QueueFilter)
                    }
                    value={queueFilter}
                  >
                    <option value="unrecorded">No finish recorded</option>
                    <option value="recorded">Finish recorded</option>
                    <option value="review">Needs review</option>
                    <option value="locked">Locked</option>
                    <option value="all">All results</option>
                  </select>
                </label>
                <button
                  className="race-completion-desk__refresh"
                  disabled={queueLoading}
                  onClick={() => void loadQueue()}
                  type="button"
                >
                  <RefreshCw
                    aria-hidden="true"
                    className={
                      queueLoading ? 'race-completion-desk__spin' : undefined
                    }
                    size={16}
                  />
                  Refresh
                </button>
              </div>

              {queueError && (
                <div className="race-completion-desk__error" role="alert">
                  <CircleAlert aria-hidden="true" size={18} />
                  {queueError}
                </div>
              )}
              {liveMessage && (
                <output className="race-completion-desk__live" aria-live="polite">
                  {liveMessage}
                </output>
              )}

              {queueLoading && items.length === 0 ? (
                <output
                  className="race-completion-desk__loading"
                  aria-live="polite"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="race-completion-desk__spin"
                    size={19}
                  />
                  Loading confirmed entrants…
                </output>
              ) : (
                <>
                  <div className="race-completion-desk__queue" aria-live="polite">
                    <div
                      className="race-completion-desk__queue-head"
                      aria-hidden="true"
                    >
                      <span>Runner</span>
                      <span>Distance</span>
                      <span>Finish time</span>
                      <span>Result</span>
                      <span>Action</span>
                    </div>
                    {visibleItems.map((item) => {
                      const isSelected =
                        item.registration_id === selectedRegistrationId;
                      const canRecord = isRecordable(item);
                      const canReview =
                        canReviewResults &&
                        item.result_status !== null &&
                        item.result_status !== 'locked';
                      return (
                        <article
                          className={`race-completion-desk__row${isSelected ? ' is-selected' : ''}`}
                          key={rowKey(item)}
                        >
                          <div className="race-completion-desk__runner">
                            <strong>{item.full_name}</strong>
                            <small>
                              {item.registration_number || 'Confirmed entry'}
                            </small>
                          </div>
                          <div data-label="Distance">{item.race} KM</div>
                          <div data-label="Finish time">
                            {item.elapsed_seconds === null
                              ? '—'
                              : formatFinishTime(item.elapsed_seconds)}
                          </div>
                          <div data-label="Result">
                            <span
                              className={`race-completion-desk__status race-completion-desk__status--${item.result_status || 'unrecorded'}`}
                            >
                              {item.result_status
                                ? resultLabels[item.result_status]
                                : 'No finish recorded'}
                            </span>
                          </div>
                          <div
                            className="race-completion-desk__row-action"
                            data-label="Action"
                          >
                            {item.result_status === 'locked' ? (
                              <span className="race-completion-desk__locked">
                                <CheckCircle2 aria-hidden="true" size={16} />
                                Final
                              </span>
                            ) : canRecord || canReview ? (
                              <button
                                onClick={() => openCompletion(item)}
                                type="button"
                              >
                                {canRecord ? 'Record finish' : 'Review result'}
                              </button>
                            ) : (
                              <span className="race-completion-desk__review-pending">
                                Awaiting administrator review
                              </span>
                            )}
                          </div>

                          {isSelected && (
                            <div
                              className="race-completion-desk__record"
                              aria-label={`Completion controls for ${item.full_name}`}
                            >
                              <div className="race-completion-desk__record-head">
                                <div>
                                  <span>
                                    {canRecord
                                      ? 'Official finish time'
                                      : 'Result decision'}
                                  </span>
                                  <strong>
                                    {item.full_name} · {item.race} KM
                                  </strong>
                                </div>
                                <button
                                  onClick={() => setSelectedRegistrationId(null)}
                                  type="button"
                                >
                                  Close
                                </button>
                              </div>

                              <div className="race-completion-desk__record-fields">
                                <label htmlFor={finishTimeId}>
                                  Finish time · HH:MM:SS
                                  <input
                                    id={finishTimeId}
                                    inputMode="numeric"
                                    onChange={(event) =>
                                      setFinishTime(event.target.value)
                                    }
                                    placeholder="00:42:18"
                                    value={finishTime}
                                  />
                                </label>
                                {canReview && (
                                  <label>
                                    Result decision
                                    <select
                                      onChange={(event) =>
                                        setReviewStatus(
                                          event.target.value as ReviewStatus,
                                        )
                                      }
                                      value={reviewStatus}
                                    >
                                      <option value="verified">Verify result</option>
                                      <option value="correction_required">
                                        Request correction
                                      </option>
                                      <option value="locked">Lock result</option>
                                    </select>
                                  </label>
                                )}
                              </div>

                              {canReview && (
                                <>
                                  <label
                                    className="race-completion-desk__note"
                                    htmlFor={reviewNoteId}
                                  >
                                    <span>
                                      Review reason <em>Required</em>
                                    </span>
                                    <textarea
                                      id={reviewNoteId}
                                      maxLength={1000}
                                      onChange={(event) =>
                                        setReviewNote(event.target.value)
                                      }
                                      placeholder="State how the finish time was checked."
                                      value={reviewNote}
                                    />
                                  </label>
                                  <label className="race-completion-desk__hold">
                                    <input
                                      checked={certificateHold}
                                      onChange={(event) =>
                                        setCertificateHold(event.target.checked)
                                      }
                                      type="checkbox"
                                    />
                                    Hold certificate pending review
                                  </label>
                                </>
                              )}

                              <div className="race-completion-desk__record-actions">
                                {canRecord && (
                                  <button
                                    className="race-completion-desk__record-finish"
                                    disabled={actionBusy}
                                    onClick={() => void recordCompletion()}
                                    type="button"
                                  >
                                    {actionBusy ? (
                                      <LoaderCircle
                                        aria-hidden="true"
                                        className="race-completion-desk__spin"
                                        size={17}
                                      />
                                    ) : (
                                      <Timer aria-hidden="true" size={17} />
                                    )}
                                    Record official finish
                                  </button>
                                )}
                                {canReview && (
                                  <button
                                    className="race-completion-desk__review-result"
                                    disabled={actionBusy}
                                    onClick={() => void reviewCompletion()}
                                    type="button"
                                  >
                                    {actionBusy ? (
                                      <LoaderCircle
                                        aria-hidden="true"
                                        className="race-completion-desk__spin"
                                        size={17}
                                      />
                                    ) : (
                                      <ClipboardCheck aria-hidden="true" size={17} />
                                    )}
                                    Save result decision
                                  </button>
                                )}
                              </div>
                              {canReview && (
                                <small className="race-completion-desk__review-note">
                                  Result decisions require an event administrator
                                  capability. Finish officials can record a time
                                  but cannot approve or lock a result.
                                </small>
                              )}
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>

                  {!queueLoading && !queueError && visibleItems.length === 0 && (
                    <div className="race-completion-desk__empty">
                      <CheckCircle2 aria-hidden="true" size={23} />
                      <div>
                        <strong>No matching entrants</strong>
                        <p>Change a filter or refresh after another finish is recorded.</p>
                      </div>
                    </div>
                  )}

                  {hasMore && (
                    <button
                      className="race-completion-desk__more"
                      disabled={queueLoading}
                      onClick={() => void loadQueue({ append: true })}
                      type="button"
                    >
                      {queueLoading ? 'Loading…' : 'Load more entrants'}
                    </button>
                  )}
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  );
}
