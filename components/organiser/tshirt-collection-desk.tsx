'use client';

import {useCallback, useEffect, useId, useState, type ComponentProps} from 'react';
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  LogOut,
  RefreshCw,
  Shirt,
  UserRoundCheck,
} from 'lucide-react';
import type {User} from '@supabase/supabase-js';
import {supabase} from '@/lib/supabase';
import {OrganiserMfaSetup, type OrganiserMfaAssurance} from './mfa-setup';
import './tshirt-collection-desk.css';

type CollectionStatus = 'ready' | 'issued' | 'all';
type RaceFilter = 'all' | '5' | '10' | '21';
type DeskAccess = 'unknown' | 'allowed' | 'denied';
type TShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | 'XXL' | 'XXXL';

type TShirtQueueItem = {
  registration_id: string;
  full_name: string;
  race: '5' | '10' | '21';
  requested_size: TShirtSize;
  tshirt_issue_id: string | null;
  issue_revision: number | null;
  source_revision: number | null;
  issued_size: TShirtSize | null;
  override_reason: string | null;
  issued_at: string | null;
};

type TShirtQueueResponse = {
  items: TShirtQueueItem[];
  next_after_registration_id: string | null;
  has_more: boolean;
};

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<'form'>['onSubmit']>
>[0];

const defaultEventId = 'suratgarh-2026';
const sizes: TShirtSize[] = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'];
const statusCopy: Record<CollectionStatus, string> = {
  ready: 'Ready to collect',
  issued: 'Collected',
  all: 'All paid runners',
};
const issuedAt = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  hour: 'numeric',
  minute: '2-digit',
});

function newRequestId() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();

  const values = new Uint8Array(16);
  crypto.getRandomValues(values);
  values[6] = (values[6] & 0x0f) | 0x40;
  values[8] = (values[8] & 0x3f) | 0x80;
  const hex = [...values].map((value) => value.toString(16).padStart(2, '0'));
  return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10).join('')}`;
}

function readQueue(value: unknown): TShirtQueueResponse {
  if (!value || typeof value !== 'object') {
    throw new Error('The T-shirt desk returned an unexpected response.');
  }
  const queue = value as Partial<TShirtQueueResponse>;
  if (!Array.isArray(queue.items) || typeof queue.has_more !== 'boolean') {
    throw new Error('The T-shirt desk returned an unexpected response.');
  }
  return {
    items: queue.items as TShirtQueueItem[],
    next_after_registration_id:
      typeof queue.next_after_registration_id === 'string'
        ? queue.next_after_registration_id
        : null,
    has_more: queue.has_more,
  };
}

function plainError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Please try again or contact an event administrator.';
}

function accessError(error: unknown) {
  return /capability|permission|organis|aal|verified email|not authorized/i.test(plainError(error));
}

function deskError(error: unknown) {
  const message = plainError(error);
  if (accessError(error)) {
    return 'This account does not have T-shirt desk access. Use a verified email, complete multi-factor sign-in and ask an event administrator to assign the desk role.';
  }
  return message;
}

function rowKey(item: TShirtQueueItem) {
  return `${item.registration_id}:${item.tshirt_issue_id ?? 'ready'}`;
}

export function OrganiserTshirtCollectionDesk({
  eventId = defaultEventId,
  pageSize = 25,
}: {
  eventId?: string;
  pageSize?: number;
}) {
  const overrideId = useId();
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState('');
  const [signInBusy, setSignInBusy] = useState(false);
  const [signInMessage, setSignInMessage] = useState('');
  const [mfaAssurance, setMfaAssurance] = useState<OrganiserMfaAssurance>('unknown');
  const [access, setAccess] = useState<DeskAccess>('unknown');
  const [statusFilter, setStatusFilter] = useState<CollectionStatus>('ready');
  const [raceFilter, setRaceFilter] = useState<RaceFilter>('all');
  const [items, setItems] = useState<TShirtQueueItem[]>([]);
  const [nextAfter, setNextAfter] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [selectedRegistrationId, setSelectedRegistrationId] = useState<string | null>(null);
  const [issuedSize, setIssuedSize] = useState<TShirtSize>('M');
  const [overrideReason, setOverrideReason] = useState('');
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [liveMessage, setLiveMessage] = useState('');

  const selected = items.find((item) => item.registration_id === selectedRegistrationId) ?? null;

  useEffect(() => {
    if (!supabase) {
      return undefined;
    }

    let active = true;
    void supabase.auth.getSession().then(({data}) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
    });
    const {data: listener} = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUser(session?.user ?? null);
      setAuthLoading(false);
      setMfaAssurance('unknown');
      setAccess('unknown');
      setItems([]);
      setNextAfter(null);
      setHasMore(false);
      setSelectedRegistrationId(null);
    });
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  const loadQueue = useCallback(async ({append = false}: {append?: boolean} = {}) => {
    if (!supabase || !user || mfaAssurance !== 'aal2') return;
    const after = append ? nextAfter : null;
    if (append && !after) return;

    setQueueLoading(true);
    setQueueError('');
    try {
      const {data, error} = await supabase.rpc('tshirt_collection_queue', {
        p_event_id: eventId,
        p_status: statusFilter,
        p_race: raceFilter === 'all' ? null : raceFilter,
        p_after_registration_id: after,
        p_limit: pageSize,
      });
      if (error) throw error;
      const queue = readQueue(data);
      setAccess('allowed');
      setItems((current) => append ? [...current, ...queue.items] : queue.items);
      setNextAfter(queue.next_after_registration_id);
      setHasMore(queue.has_more);
      if (!append) setSelectedRegistrationId(null);
    } catch (error) {
      if (accessError(error)) setAccess('denied');
      setQueueError(deskError(error));
      if (!append) {
        setItems([]);
        setNextAfter(null);
        setHasMore(false);
      }
    } finally {
      setQueueLoading(false);
    }
  }, [eventId, mfaAssurance, nextAfter, pageSize, raceFilter, statusFilter, user]);

  useEffect(() => {
    if (!user || mfaAssurance !== 'aal2') return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) return loadQueue();
      return undefined;
    });
    return () => {
      cancelled = true;
    };
  }, [loadQueue, mfaAssurance, user]);

  const handleMfaAssurance = useCallback((assurance: OrganiserMfaAssurance) => {
    setMfaAssurance(assurance);
    if (assurance === 'aal2') return;

    setAccess('unknown');
    setItems([]);
    setNextAfter(null);
    setHasMore(false);
    setSelectedRegistrationId(null);
    setQueueError('');
    setQueueLoading(false);
  }, []);

  const requestSignIn = async (event: FormSubmitEvent) => {
    event.preventDefault();
    if (!supabase || !email.trim()) return;
    setSignInBusy(true);
    setSignInMessage('');
    const {error} = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: {emailRedirectTo: window.location.origin},
    });
    setSignInBusy(false);
    setSignInMessage(error ? plainError(error) : 'Check that inbox for the secure sign-in link. Complete multi-factor sign-in before opening the desk.');
  };

  const signOut = async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    setLiveMessage('Signed out.');
  };

  const openCollection = (item: TShirtQueueItem) => {
    setSelectedRegistrationId(item.registration_id);
    setIssuedSize(item.requested_size);
    setOverrideReason('');
    setLiveMessage('');
  };

  const recordCollection = async () => {
    if (!supabase || !selected || collectionBusy) return;
    if (issuedSize !== selected.requested_size && overrideReason.trim().length < 5) {
      setQueueError('Explain the T-shirt size override before recording collection.');
      return;
    }
    if (issuedSize === selected.requested_size && overrideReason.trim()) {
      setQueueError('A size override reason is only needed when the issued size changes.');
      return;
    }

    setCollectionBusy(true);
    setQueueError('');
    try {
      const {data, error} = await supabase.rpc('record_tshirt_collection', {
        p_event_id: eventId,
        p_registration_id: selected.registration_id,
        p_issued_size: issuedSize,
        p_override_reason: overrideReason.trim(),
        p_request_id: newRequestId(),
      });
      if (error) throw error;
      const result = data as {issued_size?: string; registration_id?: string} | null;
      setSelectedRegistrationId(null);
      setLiveMessage(
        result?.registration_id
          ? `Collection recorded: ${selected.full_name} received size ${result.issued_size ?? issuedSize}.`
          : 'T-shirt collection recorded.',
      );
      await loadQueue();
    } catch (error) {
      if (accessError(error)) setAccess('denied');
      setQueueError(deskError(error));
    } finally {
      setCollectionBusy(false);
    }
  };

  if (!supabase) {
    return (
      <section className="tshirt-collection-desk" aria-labelledby="tshirt-desk-title">
        <div className="tshirt-collection-desk__header">
          <div>
            <span className="tshirt-collection-desk__eyebrow">Organiser only</span>
            <h2 id="tshirt-desk-title">T-shirt collection desk</h2>
          </div>
        </div>
        <div className="tshirt-collection-desk__notice">
          <CircleAlert aria-hidden="true" size={22} />
          <div>
            <strong>The secure desk is not configured.</strong>
            <p>Connect the private application to Supabase before an organiser can open the collection queue.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="tshirt-collection-desk" aria-labelledby="tshirt-desk-title">
      <header className="tshirt-collection-desk__header">
        <div>
          <span className="tshirt-collection-desk__eyebrow">Organiser only</span>
          <h2 id="tshirt-desk-title">T-shirt collection desk</h2>
          <p>Record one collection for each paid runner. The submitted size stays visible if a substitute is issued.</p>
        </div>
        {user && (
          <button className="tshirt-collection-desk__signout" onClick={() => void signOut()} type="button">
            <LogOut aria-hidden="true" size={16} />
            Sign out
          </button>
        )}
      </header>

      <div className="tshirt-collection-desk__window">
        <Shirt aria-hidden="true" size={20} />
        <div>
          <strong>Collection point</strong>
          <span>3 October 2026 · 09:00–13:30</span>
          <p>In front of SBI Bank, inside the station</p>
        </div>
      </div>

      {authLoading && (
        <output className="tshirt-collection-desk__loading">
          <LoaderCircle aria-hidden="true" className="tshirt-collection-desk__spin" size={19} />
          Checking secure sign-in…
        </output>
      )}

      {!authLoading && !user && (
        <form className="tshirt-collection-desk__signin" onSubmit={requestSignIn}>
          <UserRoundCheck aria-hidden="true" size={26} />
          <div>
            <h3>Open the organiser desk</h3>
            <p>Use your assigned organiser email. Multi-factor sign-in and a desk role are required.</p>
          </div>
          <label htmlFor={`${overrideId}-email`}>Organiser email</label>
          <div className="tshirt-collection-desk__signin-row">
            <input
              autoComplete="email"
              id={`${overrideId}-email`}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="name@domain"
              required
              type="email"
              value={email}
            />
            <button disabled={signInBusy} type="submit">
              {signInBusy ? <LoaderCircle aria-hidden="true" className="tshirt-collection-desk__spin" size={17} /> : 'Send sign-in link'}
            </button>
          </div>
          {signInMessage && <output>{signInMessage}</output>}
        </form>
      )}

      {!authLoading && user && (
        <>
          <div className="tshirt-collection-desk__identity">
            <UserRoundCheck aria-hidden="true" size={18} />
            <span>Signed in as <strong>{user.email ?? 'organiser account'}</strong></span>
            <span className={`tshirt-collection-desk__access tshirt-collection-desk__access--${access}`}>
              {access === 'allowed' ? 'Desk access confirmed' : access === 'denied' ? 'Desk access required' : 'Checking access'}
            </span>
          </div>

          <OrganiserMfaSetup
            key={user.id}
            onAssuranceChange={handleMfaAssurance}
            userId={user.id}
          />

          {mfaAssurance === 'aal2' && <>
          <div className="tshirt-collection-desk__filters">
            <label>
              Collection status
              <select
                onChange={(event) => setStatusFilter(event.target.value as CollectionStatus)}
                value={statusFilter}
              >
                {Object.entries(statusCopy).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label>
              Distance
              <select onChange={(event) => setRaceFilter(event.target.value as RaceFilter)} value={raceFilter}>
                <option value="all">All distances</option>
                <option value="5">5 km</option>
                <option value="10">10 km</option>
                <option value="21">21 km</option>
              </select>
            </label>
            <button
              className="tshirt-collection-desk__refresh"
              disabled={queueLoading}
              onClick={() => void loadQueue()}
              type="button"
            >
              <RefreshCw aria-hidden="true" className={queueLoading ? 'tshirt-collection-desk__spin' : undefined} size={16} />
              Refresh
            </button>
          </div>

          {queueError && (
            <div className="tshirt-collection-desk__error" role="alert">
              <CircleAlert aria-hidden="true" size={18} />
              {queueError}
            </div>
          )}
          {liveMessage && <output className="tshirt-collection-desk__live">{liveMessage}</output>}

          {queueLoading && items.length === 0 ? (
            <output className="tshirt-collection-desk__loading">
              <LoaderCircle aria-hidden="true" className="tshirt-collection-desk__spin" size={19} />
              Loading paid runners…
            </output>
          ) : (
            <>
              <div className="tshirt-collection-desk__queue" aria-live="polite">
                <div className="tshirt-collection-desk__queue-head" aria-hidden="true">
                  <span>Runner</span><span>Distance</span><span>Requested</span><span>Collection</span>
                </div>
                {items.map((item) => {
                  const canRecord = item.tshirt_issue_id === null;
                  const isSelected = item.registration_id === selectedRegistrationId;
                  return (
                    <article className={`tshirt-collection-desk__row${isSelected ? ' is-selected' : ''}`} key={rowKey(item)}>
                      <div className="tshirt-collection-desk__runner">
                        <strong>{item.full_name}</strong>
                        <small>{canRecord ? 'Payment verified' : `Issued ${item.issued_at ? issuedAt.format(new Date(item.issued_at)) : ''}`}</small>
                      </div>
                      <div data-label="Distance">{item.race} km</div>
                      <div data-label="Requested size"><strong>{item.requested_size}</strong></div>
                      <div className="tshirt-collection-desk__row-action" data-label="Collection">
                        {canRecord ? (
                          <button onClick={() => openCollection(item)} type="button">Record collection</button>
                        ) : (
                          <span className="tshirt-collection-desk__issued">
                            <CheckCircle2 aria-hidden="true" size={16} />
                            {item.issued_size}
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <div className="tshirt-collection-desk__record" aria-label={`Record collection for ${item.full_name}`}>
                          <div className="tshirt-collection-desk__record-head">
                            <div>
                              <span>Confirm handover</span>
                              <strong>{item.full_name} · requested {item.requested_size}</strong>
                            </div>
                            <button onClick={() => setSelectedRegistrationId(null)} type="button">Cancel</button>
                          </div>
                          <div className="tshirt-collection-desk__record-fields">
                            <label>
                              Issued size
                              <select onChange={(event) => setIssuedSize(event.target.value as TShirtSize)} value={issuedSize}>
                                {sizes.map((size) => <option key={size} value={size}>{size}</option>)}
                              </select>
                            </label>
                            {issuedSize !== item.requested_size && (
                              <label>
                                Override reason <em>Required</em>
                                <input
                                  maxLength={500}
                                  onChange={(event) => setOverrideReason(event.target.value)}
                                  placeholder="For example, requested size was unavailable."
                                  value={overrideReason}
                                />
                              </label>
                            )}
                          </div>
                          <button
                            className="tshirt-collection-desk__confirm"
                            disabled={collectionBusy}
                            onClick={() => void recordCollection()}
                            type="button"
                          >
                            {collectionBusy ? <LoaderCircle aria-hidden="true" className="tshirt-collection-desk__spin" size={17} /> : <CheckCircle2 aria-hidden="true" size={17} />}
                            Record T-shirt collection
                          </button>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>

              {!queueLoading && !queueError && items.length === 0 && (
                <div className="tshirt-collection-desk__empty">
                  <CheckCircle2 aria-hidden="true" size={22} />
                  <div>
                    <strong>No matching paid runners</strong>
                    <p>Change a filter or return after payment verification.</p>
                  </div>
                </div>
              )}

              {hasMore && (
                <button
                  className="tshirt-collection-desk__more"
                  disabled={queueLoading}
                  onClick={() => void loadQueue({append: true})}
                  type="button"
                >
                  {queueLoading ? 'Loading…' : 'Load more runners'}
                </button>
              )}
            </>
          )}
          </>}
        </>
      )}
    </section>
  );
}
