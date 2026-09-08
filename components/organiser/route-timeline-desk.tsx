import {
  useCallback,
  useEffect,
  useId,
  useState,
  type ComponentProps,
} from 'react';
import {
  Eye,
  LoaderCircle,
  MapPinned,
  RefreshCw,
  Send,
  ShieldCheck,
} from 'lucide-react';
import type { User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import {
  OrganiserMfaSetup,
  type OrganiserMfaAssurance,
} from './mfa-setup';
import './route-timeline-desk.css';

type FormSubmitEvent = Parameters<
  NonNullable<ComponentProps<'form'>['onSubmit']>
>[0];

type RouteDistance = '5' | '10' | '21';

type Timeline = {
  start: string;
  distances: Array<{ distance: RouteDistance; steps: string[] }>;
  notice?: string;
};

type Publication = {
  published: boolean;
  revision: number;
  timeline: Timeline | null;
};

type Draft = {
  start: string;
  five: string;
  ten: string;
  twentyOne: string;
  notice: string;
};

const eventId = 'suratgarh-2026';
const blankDraft: Draft = {
  start: '',
  five: '',
  ten: '',
  twentyOne: '',
  notice: 'Follow event marshals and the final station directions at all times.',
};

function requestId() {
  return crypto.randomUUID();
}

function plainError(error: unknown) {
  return error instanceof Error && error.message
    ? error.message
    : 'The route workspace is unavailable. Please retry.';
}

function isAccessError(error: unknown) {
  return /capability|permission|organis|aal|verified email|not authorized/i.test(
    plainError(error),
  );
}

function readText(value: unknown, limit: number) {
  return typeof value === 'string' && value.trim().length <= limit
    ? value.trim()
    : null;
}

function readTimeline(value: unknown): Timeline | null {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  const start = readText(source.start, 180);
  if (!start || !Array.isArray(source.distances)) return null;

  const distances = source.distances
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const segment = item as Record<string, unknown>;
      const distance = ['5', '10', '21'].includes(String(segment.distance))
        ? (String(segment.distance) as RouteDistance)
        : null;
      const steps = Array.isArray(segment.steps)
        ? segment.steps
            .map((step) => readText(step, 220))
            .filter((step): step is string => Boolean(step))
        : [];
      return distance && steps.length >= 2 ? { distance, steps } : null;
    })
    .filter((item): item is Timeline['distances'][number] => Boolean(item));

  if (distances.length !== 3) return null;
  return {
    start,
    distances,
    notice: readText(source.notice, 500) ?? undefined,
  };
}

function readPublication(value: unknown): Publication {
  if (!value || typeof value !== 'object') {
    throw new Error('The route workspace returned an unexpected response.');
  }
  const source = value as Record<string, unknown>;
  const revision = source.revision;
  if (!Number.isInteger(revision) || Number(revision) < 0) {
    throw new Error('The route workspace returned an unexpected response.');
  }
  return {
    published: source.published === true,
    revision: Number(revision),
    timeline: readTimeline(source.timeline),
  };
}

function lines(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean);
}

function draftFrom(timeline: Timeline | null): Draft {
  if (!timeline) return blankDraft;
  const stepsFor = (distance: RouteDistance) =>
    timeline.distances.find((segment) => segment.distance === distance)?.steps.join('\n') ||
    '';
  return {
    start: timeline.start,
    five: stepsFor('5'),
    ten: stepsFor('10'),
    twentyOne: stepsFor('21'),
    notice: timeline.notice || blankDraft.notice,
  };
}

function timelineFrom(draft: Draft): Timeline {
  return {
    start: draft.start.trim(),
    distances: [
      { distance: '5', steps: lines(draft.five) },
      { distance: '10', steps: lines(draft.ten) },
      { distance: '21', steps: lines(draft.twentyOne) },
    ],
    notice: draft.notice.trim(),
  };
}

export function OrganiserRouteTimelineDesk() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(Boolean(supabase));
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [mfaAssurance, setMfaAssurance] = useState<OrganiserMfaAssurance>('unknown');
  const [publication, setPublication] = useState<Publication | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const emailId = useId();
  const otpId = useId();

  const load = useCallback(async () => {
    if (!supabase || !user || mfaAssurance !== 'aal2') return;
    setLoading(true);
    setError('');
    try {
      const { data, error: failure } = await supabase.rpc('get_route_publication', {
        p_event_id: eventId,
      });
      if (failure) throw failure;
      const next = readPublication(data);
      setPublication(next);
      setDraft(draftFrom(next.timeline));
    } catch (failure) {
      setError(
        isAccessError(failure)
          ? 'This account does not have route-publishing access.'
          : plainError(failure),
      );
    } finally {
      setLoading(false);
    }
  }, [mfaAssurance, user]);

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setUser(data.session?.user ?? null);
      setAuthLoading(false);
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
    if (mfaAssurance !== 'aal2') return undefined;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load, mfaAssurance]);

  async function signIn(event: FormSubmitEvent) {
    event.preventDefault();
    if (!supabase) return;
    setSignInBusy(true);
    setError('');
    setMessage('');
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
        setMessage('Check the organiser inbox for the sign-in code.');
      }
    } catch {
      setError(sent ? 'That sign-in code is invalid or expired.' : 'We could not send a sign-in code.');
    } finally {
      setSignInBusy(false);
    }
  }

  async function publish(event: FormSubmitEvent) {
    event.preventDefault();
    if (!supabase || !publication) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: failure } = await supabase.rpc('publish_member_route', {
        p_event_id: eventId,
        p_timeline: timelineFrom(draft),
        p_expected_revision: publication.revision,
        p_request_id: requestId(),
      });
      if (failure) throw failure;
      setMessage('The protected member route is published.');
      await load();
    } catch (failure) {
      setError(plainError(failure));
    } finally {
      setBusy(false);
    }
  }

  async function unpublish() {
    if (!supabase || !publication?.published) return;
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: failure } = await supabase.rpc('unpublish_member_route', {
        p_event_id: eventId,
        p_expected_revision: publication.revision,
        p_request_id: requestId(),
      });
      if (failure) throw failure;
      setMessage('The member route is no longer visible to participants.');
      await load();
    } catch (failure) {
      setError(plainError(failure));
    } finally {
      setBusy(false);
    }
  }

  if (!supabase) {
    return (
      <section className="route-desk route-desk--notice">
        <ShieldCheck size={21} />
        <p>Route publishing becomes available when the private event service is configured.</p>
      </section>
    );
  }

  if (authLoading) {
    return <p className="route-desk__loading">Checking organiser sign-in…</p>;
  }

  if (!user) {
    return (
      <section className="route-desk route-desk--signin">
        <span>ORGANISER ONLY</span>
        <h2>Publish the member route</h2>
        <p>Use your organiser email, then complete multi-factor sign-in.</p>
        {error && <p className="route-desk__error" role="alert">{error}</p>}
        {message && <output className="route-desk__message">{message}</output>}
        <form onSubmit={signIn}>
          <label htmlFor={emailId}>Organiser email</label>
          <input
            autoComplete="email"
            id={emailId}
            onChange={(event) => setEmail(event.target.value)}
            readOnly={sent}
            required
            type="email"
            value={email}
          />
          {sent && (
            <>
              <label htmlFor={otpId}>Email sign-in code</label>
              <input
                autoComplete="one-time-code"
                id={otpId}
                inputMode="numeric"
                onChange={(event) => setOtp(event.target.value.replace(/\D/g, '').slice(0, 10))}
                pattern="[0-9]{6,10}"
                required
                value={otp}
              />
            </>
          )}
          <button disabled={signInBusy} type="submit">
            {sent ? 'Verify email' : 'Send sign-in code'}
          </button>
        </form>
      </section>
    );
  }

  return (
    <section className="route-desk" aria-labelledby="route-desk-title">
      <div className="route-desk__heading">
        <MapPinned size={23} />
        <div>
          <span>PROTECTED MEMBER CONTENT</span>
          <h2 id="route-desk-title">Route timeline</h2>
          <p>Only invited participants can view a published route.</p>
        </div>
      </div>
      <p className="route-desk__account">{user.email}</p>
      <OrganiserMfaSetup
        onAssuranceChange={setMfaAssurance}
        userId={user.id}
      />
      {mfaAssurance === 'aal2' && (
        <>
          {error && <p className="route-desk__error" role="alert">{error}</p>}
          {message && <output className="route-desk__message">{message}</output>}
          {loading ? (
            <p className="route-desk__loading" aria-live="polite">
              <LoaderCircle className="spin" size={17} /> Loading protected route…
            </p>
          ) : publication ? (
            <form className="route-desk__form" onSubmit={publish}>
              <div className="route-desk__status">
                <Eye size={17} />
                <span>{publication.published ? 'Visible to invited participants' : 'Saved as a private draft'}</span>
                <small>Revision {publication.revision}</small>
              </div>
              <label>
                Start / finish point
                <input
                  maxLength={180}
                  onChange={(event) => setDraft((current) => ({ ...current, start: event.target.value }))}
                  required
                  value={draft.start}
                />
              </label>
              <RouteSteps
                label="5 KM timeline steps"
                onChange={(value) => setDraft((current) => ({ ...current, five: value }))}
                value={draft.five}
              />
              <RouteSteps
                label="10 KM timeline steps"
                onChange={(value) => setDraft((current) => ({ ...current, ten: value }))}
                value={draft.ten}
              />
              <RouteSteps
                label="21 KM timeline steps"
                onChange={(value) => setDraft((current) => ({ ...current, twentyOne: value }))}
                value={draft.twentyOne}
              />
              <label>
                Participant safety note
                <textarea
                  maxLength={500}
                  onChange={(event) => setDraft((current) => ({ ...current, notice: event.target.value }))}
                  required
                  rows={3}
                  value={draft.notice}
                />
              </label>
              <div className="route-desk__actions">
                <button disabled={busy} type="submit">
                  {busy ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />}
                  {publication.published ? 'Update member route' : 'Publish member route'}
                </button>
                {publication.published && (
                  <button disabled={busy} onClick={() => void unpublish()} type="button">
                    Remove from member view
                  </button>
                )}
                <button disabled={busy} onClick={() => void load()} type="button">
                  <RefreshCw size={16} /> Refresh
                </button>
              </div>
            </form>
          ) : null}
        </>
      )}
    </section>
  );
}

function RouteSteps({
  label,
  onChange,
  value,
}: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  return (
    <label>
      {label}
      <textarea
        aria-describedby={`${label.replaceAll(' ', '-').toLowerCase()}-hint`}
        onChange={(event) => onChange(event.target.value)}
        placeholder="One milestone per line"
        required
        rows={4}
        value={value}
      />
      <small id={`${label.replaceAll(' ', '-').toLowerCase()}-hint`}>
        Use two to eight short steps. Participants see them in this order.
      </small>
    </label>
  );
}
