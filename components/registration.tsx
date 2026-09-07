'use client';
import { useEffect, useState, useRef, type FormEvent } from 'react';
import {
  ArrowRight,
  ArrowLeft,
  Check,
  ShieldCheck,
  LockKeyhole,
  Mail,
  UploadCloud,
  FileCheck2,
  Info,
  X,
  LoaderCircle,
  Copy,
  Download,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Checkbox } from '@/components/ui/checkbox';
import { supabase } from '@/lib/supabase';
import {
  isUsablePaymentQrUrl,
  readPaymentQrBlob,
  useEventAvailability,
} from '@/lib/event-availability';
import { RACE_FEES } from '@/lib/race-data';
import type { User } from '@supabase/supabase-js';

const eventId = 'suratgarh-2026';
const raceNames: Record<string, string> = {
  '5': 'Fun Run',
  '10': 'Challenge Run',
  '21': 'Half Marathon',
};
const participantOptions = [
  { value: 'airwarrior', label: 'Airwarrior' },
  { value: 'family', label: 'Family member' },
];
const genderOptions = [
  { value: 'male', label: 'Male' },
  { value: 'female', label: 'Female' },
  { value: 'other', label: 'Other' },
  { value: 'prefer_not_to_say', label: 'Prefer not to say' },
];
const blank = {
  full_name: '',
  mobile: '',
  dob: '',
  gender: '',
  tshirt: '',
  blood_group: '',
  emergency_contact: '',
  city: 'Suratgarh',
  participant_type: 'airwarrior',
  transaction_id: '',
};
type Details = typeof blank;
type Entry = {
  id: string;
  full_name: string;
  race: string;
  payment_status: string;
};
type RegistrationMode = 'register' | 'status';

function Choice({
  label,
  name,
  value,
  options,
  onChange,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  options: (string | { value: string; label: string })[];
  onChange: (v: string) => void;
  hint?: string;
}) {
  const items = options.map((option) =>
    typeof option === 'string' ? { value: option, label: option } : option,
  );
  const selectedLabel = items.find((item) => item.value === value)?.label;
  return (
    <div className="form-field">
      <label htmlFor={name}>
        {label} <span>*</span>
      </label>
      <Select value={value || null} onValueChange={(v) => onChange(v || '')}>
        <SelectTrigger
          id={name}
          className="form-select"
          aria-describedby={hint}
        >
          <SelectValue placeholder="Select an option">
            {selectedLabel}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function OrganiserContacts() {
  return (
    <>
      <a href="tel:+918838463776">88384 63776</a> or{' '}
      <a href="tel:+917027964880">70279 64880</a>
    </>
  );
}

export function Registration({
  race,
  onClose,
  onPolicy,
  onChooseRace,
  mode = 'register',
}: {
  race: string;
  onClose: () => void;
  onPolicy: (p: string) => void;
  onChooseRace?: () => void;
  mode?: RegistrationMode;
}) {
  const { config, availability, confirmedFees } = useEventAvailability();
  const [view, setView] = useState<RegistrationMode>(mode);
  const [step, setStep] = useState(0),
    [chosen, setChosen] = useState(race),
    [details, setDetails] = useState<Details>(blank);
  const [email, setEmail] = useState(''),
    [otp, setOtp] = useState(''),
    [code, setCode] = useState(''),
    [sent, setSent] = useState(false);
  const [user, setUser] = useState<User | null>(null),
    [authChecking, setAuthChecking] = useState(!!supabase);
  const [preview, setPreview] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [message, setMessage] = useState('');
  const [paymentFeedback, setPaymentFeedback] = useState<{
    context: string;
    text: string;
  } | null>(null);
  const paymentDownload = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null),
    [fileUrl, setFileUrl] = useState(''),
    [consent, setConsent] = useState(false);
  const [result, setResult] = useState<{
      registration_id: string;
      payment_status: string;
    } | null>(null),
    [submissionId, setSubmissionId] = useState('');
  const [entries, setEntries] = useState<Entry[]>([]),
    [entriesLoading, setEntriesLoading] = useState(false),
    [entriesError, setEntriesError] = useState(''),
    [entriesRevision, setEntriesRevision] = useState(0);
  const [correctionEntryId, setCorrectionEntryId] = useState<string | null>(
      null,
    ),
    [correctionTransactionId, setCorrectionTransactionId] = useState(''),
    [correctionFile, setCorrectionFile] = useState<File | null>(null),
    [correctionBusy, setCorrectionBusy] = useState(false),
    [correctionError, setCorrectionError] = useState(''),
    [correctionMessage, setCorrectionMessage] = useState('');
  const correctionRequestId = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  const active = availability === 'open';
  const liveFeesRequired =
    !preview &&
    (step > 0 || !!config?.payment_configured || availability === 'unavailable');
  const fees: Record<string, number> | null = liveFeesRequired
    ? confirmedFees
    : RACE_FEES;
  const feeLabel = (distance: string) =>
    fees?.[distance] === undefined
      ? 'Unavailable'
      : `₹${fees[distance].toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const confirmedAmount = confirmedFees?.[chosen as keyof typeof confirmedFees];
  const paymentToolsEnabled =
    active &&
    !preview &&
    !!config?.payment_configured &&
    !!config.payee_name?.trim() &&
    !!config.upi_id?.trim() &&
    isUsablePaymentQrUrl(config.payment_qr_url) &&
    Number.isFinite(confirmedAmount);
  const statusMode = view === 'status';
  const canSignIn = !!supabase && (statusMode || active);
  const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10);
  const paymentContext = JSON.stringify([
    step,
    view,
    chosen,
    confirmedAmount,
    paymentToolsEnabled,
    config?.payment_qr_url,
    config?.upi_id,
    config?.payee_name,
  ]);

  useEffect(() => {
    return () => paymentDownload.current?.abort();
  }, [paymentContext]);

  function announcePayment(text: string) {
    setPaymentFeedback({ context: paymentContext, text });
  }

  async function copyPaymentValue(kind: 'upi' | 'amount') {
    if (!paymentToolsEnabled || !config || busy) return;
    setBusy(true);
    setPaymentFeedback(null);
    try {
      await navigator.clipboard.writeText(
        kind === 'upi' ? config.upi_id!.trim() : String(confirmedAmount),
      );
      announcePayment(
        kind === 'upi'
          ? `UPI ID copied for ${config.payee_name}.`
          : `Amount ${confirmedAmount} copied for ${chosen} KM.`,
      );
    } catch {
      announcePayment(
        `Clipboard unavailable. Select and copy the ${kind === 'upi' ? 'UPI ID' : 'amount'} shown above.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function savePaymentQR() {
    if (!paymentToolsEnabled || !config?.payment_qr_url || busy) return;
    const controller = new AbortController();
    paymentDownload.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    setBusy(true);
    announcePayment('Preparing QR download…');
    try {
      const response = await fetch(config.payment_qr_url, {
        credentials: 'omit',
        cache: 'no-store',
        signal: controller.signal,
      });
      const blob = await readPaymentQrBlob(response);
      const extensions: Record<string, string> = {
        'image/png': 'png',
        'image/jpeg': 'jpg',
        'image/webp': 'webp',
        'image/gif': 'gif',
        'image/svg+xml': 'svg',
      };
      const extension = extensions[blob.type.toLowerCase().split(';')[0]];
      if (!extension) throw new Error('QR image unavailable');
      if (controller.signal.aborted) return;
      // Never offer a download if the payment deadline passed during the fetch.
      if (Date.now() > Date.parse(config.registration_deadline)) return;
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `desert-braves-payment-qr-${chosen}km.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      announcePayment('QR download requested. Check your downloads.');
    } catch {
      announcePayment(
        'QR download unavailable. Use your browser’s image menu to save it, or copy the UPI ID.',
      );
    } finally {
      window.clearTimeout(timeout);
      if (paymentDownload.current === controller)
        paymentDownload.current = null;
      setBusy(false);
    }
  }

  useEffect(() => {
    let pending = crypto.randomUUID();
    try {
      pending = sessionStorage.getItem('sekhon-pending-submission') || pending;
      sessionStorage.setItem('sekhon-pending-submission', pending);
    } catch {}
    setSubmissionId(pending);
    if (!supabase) return;
    let alive = true;
    const client = supabase;
    client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!alive) return;
        setUser(data.session?.user || null);
        setAuthChecking(false);
        if (sessionError)
          setError('We could not check your sign-in. Please sign in again.');
      })
      .catch(() => {
        if (alive) {
          setAuthChecking(false);
          setError('We could not check your sign-in. Please try again.');
        }
      });
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (alive) {
        setUser(session?.user || null);
        setAuthChecking(false);
      }
    });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!file) {
      setFileUrl('');
      return;
    }
    const url = URL.createObjectURL(file);
    setFileUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    setError('');
    const frame = requestAnimationFrame(() => {
      heading.current?.focus({ preventScroll: true });
      heading.current
        ?.closest('[role="dialog"]')
        ?.scrollTo({ top: 0, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [step, view]);

  useEffect(() => {
    if (!error) return;
    const frame = requestAnimationFrame(() => {
      const message = errorMessage.current;
      if (!message) return;
      message.focus({ preventScroll: true });
      const dialog = message.closest('[role="dialog"]');
      if (!dialog) return;
      // Keep the heading and close control visible whenever the viewport allows.
      dialog.scrollTo({ top: 0, behavior: 'instant' });
      const overflow =
        message.getBoundingClientRect().bottom -
        dialog.getBoundingClientRect().bottom +
        16;
      if (overflow > 0) dialog.scrollTo({ top: overflow, behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [error]);

  useEffect(() => {
    if (!sent) return;
    const frame = requestAnimationFrame(() =>
      document.getElementById('email-code')?.focus(),
    );
    return () => cancelAnimationFrame(frame);
  }, [sent]);

  useEffect(() => {
    setEntries([]);
    setEntriesError('');
    if (!user || !supabase) {
      setEntriesLoading(false);
      return;
    }
    let alive = true;
    setEntriesLoading(true);
    supabase
      .from('registrations')
      .select('id,full_name,race,payment_status')
      .eq('user_id', user.id)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false })
      .limit(30)
      .then(
        ({ data, error: queryError }) => {
          if (!alive) return;
          if (queryError)
            setEntriesError(
              'Your entries could not be loaded. Please try again; do not make another payment.',
            );
          else setEntries(data || []);
          setEntriesLoading(false);
        },
        () => {
          if (alive) {
            setEntriesLoading(false);
            setEntriesError(
              'Your entries could not be loaded. Check your connection and try again.',
            );
          }
        },
      );
    return () => {
      alive = false;
    };
  }, [user, entriesRevision]);

  const set = (field: keyof Details, value: string) =>
    setDetails((current) => ({ ...current, [field]: value }));
  function switchView(next: RegistrationMode) {
    if (busy) return;
    if (next === 'register' && result) {
      const nextSubmission = crypto.randomUUID();
      setSubmissionId(nextSubmission);
      setDetails(blank);
      setConsent(false);
      setFile(null);
      setResult(null);
      try {
        sessionStorage.setItem('sekhon-pending-submission', nextSubmission);
      } catch {}
    }
    setView(next);
    setStep(0);
    setPreview(false);
    setMessage('');
    setError('');
  }

  async function sendEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canSignIn) return;
    setBusy(true);
    setError('');
    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: {
          shouldCreateUser: !statusMode,
          emailRedirectTo:
            window.location.origin +
            (process.env.NEXT_PUBLIC_BASE_PATH || '') +
            '/',
        },
      });
      if (authError) throw authError;
      setSent(true);
      setMessage(
        statusMode
          ? 'If this email has an account, a sign-in code is on its way. Check the inbox used for your registration.'
          : 'Check your inbox for the sign-in code. It may take a moment to arrive.',
      );
    } catch {
      setError(
        statusMode
          ? 'We could not send the code. Use the email address you registered with, or try again shortly.'
          : 'We could not send the sign-in email. Please check the address and try again shortly.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function verifyEmail(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !canSignIn) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: authError } = await supabase.auth.verifyOtp({
        email: email.trim().toLowerCase(),
        token: otp.trim(),
        type: 'email',
      });
      if (authError) throw authError;
      setUser(data.user);
      setMessage('');
      setSent(false);
      setOtp('');
      requestAnimationFrame(() =>
        heading.current?.focus({ preventScroll: true }),
      );
    } catch {
      setError(
        'That code is invalid or has expired. Check your email or request a new code.',
      );
    } finally {
      setBusy(false);
    }
  }

  async function signOut() {
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { error: authError } = await supabase.auth.signOut();
      if (authError) throw authError;
      setUser(null);
      setSent(false);
      setOtp('');
      setCode('');
      setMessage('');
    } catch {
      setError('We could not sign you out. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function redeem(event: FormEvent) {
    event.preventDefault();
    if (!supabase || !user || !active) return;
    setBusy(true);
    setError('');
    try {
      const { data, error: invitationError } = await supabase.rpc(
        'redeem_invitation',
        { p_code: code.trim(), p_event_id: eventId },
      );
      if (invitationError || !data?.ok)
        setError(
          data?.code === 'rate_limited'
            ? 'Too many attempts. Please try again later.'
            : 'The station code could not be verified. Check it with the organising team.',
        );
      else {
        setCode('');
        setStep(1);
      }
    } catch {
      setError(
        'We could not verify your station code. Check your connection and try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  function nextDetails(event: FormEvent) {
    event.preventDefault();
    if (!details.gender || !details.tshirt || !details.blood_group) {
      setError('Please select your gender, T-shirt size and blood group.');
      return;
    }
    if (details.mobile === details.emergency_contact) {
      setError('Please use another person’s number for the emergency contact.');
      return;
    }
    setStep(2);
  }

  function selectFile(selected: File | undefined) {
    setError('');
    if (!selected) return;
    if (
      !['image/jpeg', 'image/png'].includes(selected.type) ||
      selected.size > 5 * 1024 * 1024 ||
      selected.size === 0
    ) {
      setFile(null);
      setError('Choose a JPG or PNG screenshot, no larger than 5 MB.');
      return;
    }
    setFile(selected);
  }

  function resetPaymentCorrection() {
    correctionRequestId.current = null;
    setCorrectionEntryId(null);
    setCorrectionTransactionId('');
    setCorrectionFile(null);
    setCorrectionError('');
  }

  function beginPaymentCorrection(entryId: string) {
    resetPaymentCorrection();
    setCorrectionMessage('');
    setCorrectionEntryId(entryId);
  }

  function selectCorrectionFile(selected: File | undefined) {
    setCorrectionError('');
    correctionRequestId.current = null;
    if (!selected) {
      setCorrectionFile(null);
      return;
    }
    if (
      !['image/jpeg', 'image/png'].includes(selected.type) ||
      selected.size > 5 * 1024 * 1024 ||
      selected.size === 0
    ) {
      setCorrectionFile(null);
      setCorrectionError('Choose a JPG or PNG screenshot, no larger than 5 MB.');
      return;
    }
    setCorrectionFile(selected);
  }

  async function submitPaymentCorrection(event: FormEvent, entry: Entry) {
    event.preventDefault();
    if (!supabase || !user || !correctionFile) return;
    const transactionId = correctionTransactionId.trim();
    if (!/^[A-Za-z0-9-]{6,64}$/.test(transactionId)) {
      setCorrectionError('Enter the payment reference shown in your UPI app.');
      return;
    }

    const requestId = correctionRequestId.current || crypto.randomUUID();
    correctionRequestId.current = requestId;
    setCorrectionBusy(true);
    setCorrectionError('');
    setCorrectionMessage('');
    try {
      const body = new FormData();
      body.set(
        'payload',
        JSON.stringify({
          event_id: eventId,
          registration_id: entry.id,
          correction_id: requestId,
          transaction_id: transactionId,
        }),
      );
      body.set('receipt', correctionFile);
      const { data, error: submitError } = await supabase.functions.invoke(
        'correct-payment',
        { body },
      );
      if (submitError) {
        let explanation =
          'We could not save the replacement proof. Please retry without making another payment.';
        try {
          const response = await submitError.context?.json();
          if (response?.error) explanation = response.error;
        } catch {}
        throw new Error(explanation);
      }
      if (data?.payment_status !== 'pending_review') {
        throw new Error(
          'The replacement proof could not be confirmed. Please retry without making another payment.',
        );
      }
      setCorrectionMessage(
        'Replacement payment proof received. It is now awaiting organiser verification.',
      );
      resetPaymentCorrection();
      setEntriesRevision((current) => current + 1);
    } catch (failure) {
      setCorrectionError(
        failure instanceof Error
          ? failure.message
          : 'We could not save the replacement proof. Please retry.',
      );
    } finally {
      setCorrectionBusy(false);
    }
  }

  async function submit() {
    if (preview || !supabase || !user || !active || !consent || !file) return;
    setBusy(true);
    setError('');
    try {
      const body = new FormData();
      body.set(
        'payload',
        JSON.stringify({
          ...details,
          race: chosen,
          submission_id: submissionId,
          event_id: eventId,
          consent: true,
        }),
      );
      body.set('receipt', file);
      const { data, error: submitError } = await supabase.functions.invoke(
        'submit-registration',
        { body },
      );
      if (submitError) {
        let explanation =
          'We could not submit your entry. Please retry; your payment should not be repeated.';
        try {
          const response = await submitError.context?.json();
          if (response?.error) explanation = response.error;
        } catch {}
        throw new Error(explanation);
      }
      if (!data?.registration_id)
        throw new Error(
          'No receipt was returned. Please retry without making another payment.',
        );
      setResult(data);
      setEntriesRevision((current) => current + 1);
      try {
        sessionStorage.removeItem('sekhon-pending-submission');
      } catch {}
      setStep(4);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Submission failed. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const spinner = busy ? (
    <LoaderCircle size={17} className="spin" />
  ) : (
    <ArrowRight size={17} />
  );
  const title = statusMode
    ? 'Check your entry'
    : step === 4
      ? 'Entry received'
      : step === 0
        ? 'Registration'
        : step === 1
          ? 'Participant details'
          : step === 2
            ? preview
              ? 'Payment preview'
              : active
                ? 'Complete payment'
                : 'Payment unavailable'
            : 'Review your entry';
  const signedIn = user && (
    <div className="signed-in">
      <Mail size={16} />
      <span>Signed in as {user.email}</span>
      <button
        type="button"
        className="plain-button"
        disabled={busy}
        onClick={signOut}
      >
        Sign out
      </button>
    </div>
  );
  const signInForm = (
    <>
      <div className="access-heading">
        <ShieldCheck size={20} />
        <p>
          {statusMode
            ? 'Use your registration email.'
            : 'For airwarriors and families.'}
          <br />
          <span>
            {statusMode
              ? 'Check your payment status, including after registration closes.'
              : 'Sign in with your email, then enter your station code.'}
          </span>
        </p>
      </div>
      {!sent ? (
        <form className="registration-form" onSubmit={sendEmail}>
          <div className="form-field">
            <label htmlFor="signin-email">Email address</label>
            <input
              id="signin-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              autoCapitalize="none"
              spellCheck={false}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              maxLength={254}
              placeholder="you@example.com"
            />
          </div>
          <button className="button" disabled={busy} type="submit">
            Send sign-in code {spinner}
          </button>
          <p className="privacy-hint">
            <LockKeyhole size={13} />{' '}
            {statusMode
              ? 'Only entries linked to your verified email are shown.'
              : 'Your email is used for registration and event communication.'}
          </p>
        </form>
      ) : (
        <form className="registration-form" onSubmit={verifyEmail}>
          <div className="form-field">
            <label htmlFor="email-code">Sign-in code from your email</label>
            <input
              id="email-code"
              type="text"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6,10}"
              minLength={6}
              maxLength={10}
              value={otp}
              onChange={(event) => setOtp(event.target.value)}
              required
              placeholder="Enter the code"
            />
            <small>Sent to {email.trim()}</small>
          </div>
          <button className="button" disabled={busy} type="submit">
            Verify email {spinner}
          </button>
          <button
            type="button"
            className="plain-button"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setOtp('');
              setMessage('');
            }}
          >
            Change email or request a new code
          </button>
        </form>
      )}
    </>
  );

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="registration-dialog" initialFocus={heading}>
        <div className="registration-header">
          <div className="eyebrow">
            AIR FORCE STATION SURATGARH · SEKHON 2026
          </div>
          <DialogTitle ref={heading} tabIndex={-1}>
            {title}
          </DialogTitle>
          <DialogDescription>
            {statusMode
              ? 'Your entry and payment status, in one place.'
              : step === 4
                ? 'Keep your registration reference for payment queries.'
                : '4 October 2026 · Air Force Station Suratgarh'}
          </DialogDescription>
        </div>
        {!statusMode && step < 4 && (
          <ol className="registration-steps" aria-label="Registration progress">
            {['Access', 'Participant', 'Payment', 'Review'].map(
              (label, index) => (
                <li
                  className={
                    index === step ? 'current' : index < step ? 'complete' : ''
                  }
                  key={label}
                  aria-current={index === step ? 'step' : undefined}
                >
                  <span>{index < step ? <Check size={13} /> : index + 1}</span>
                  {label}
                </li>
              ),
            )}
          </ol>
        )}
        {preview && (
          <div className="preview-notice">
            <Info size={16} />
            <span>
              {step === 3
                ? 'Preview complete · No entry or payment has been submitted.'
                : 'Preview only · Nothing is saved or submitted.'}
            </span>
          </div>
        )}
        {error && (
          <p
            ref={errorMessage}
            className="form-error"
            role="alert"
            tabIndex={-1}
          >
            {error}
          </p>
        )}
        {message && (
          <p className="form-message" role="status">
            {message}
          </p>
        )}
        {!statusMode && step > 0 && step < 4 && (
          <div className="selection-summary">
            <span>
              <b>{chosen} KM</b> {raceNames[chosen]}
            </span>
            <strong>{feeLabel(chosen)}</strong>
          </div>
        )}

        {step === 0 && (
          <>
            {!statusMode && (
              <RadioGroup
                value={chosen}
                onValueChange={(value) => setChosen(String(value))}
                className="registration-races"
                aria-label="Choose race distance"
              >
                {Object.keys(raceNames).map((distance) => (
                  <label
                    key={distance}
                    className={chosen === distance ? 'selected' : ''}
                  >
                    <RadioGroupItem value={distance} />
                    <span>
                      <b>{distance} KM</b>
                      <small>{raceNames[distance]}</small>
                    </span>
                    <strong>{feeLabel(distance)}</strong>
                  </label>
                ))}
              </RadioGroup>
            )}
            {!statusMode && (
              <p className="planned-fee-note">
                {liveFeesRequired
                  ? confirmedFees
                    ? 'Confirmed fees.'
                    : 'Fees unavailable. Payments are not open.'
                  : 'Confirmed event fees. Payment details are still being updated.'}
              </p>
            )}
            {statusMode ? (
              !supabase ? (
                <div className="notice">
                  <Info />
                  <div>
                    <b>Entry lookup is not available</b>
                    <p>
                      For help with an existing entry or payment, call{' '}
                      <OrganiserContacts />.
                    </p>
                  </div>
                </div>
              ) : authChecking ? (
                <div className="notice" role="status">
                  <LoaderCircle className="spin" />
                  <p>Checking your sign-in…</p>
                </div>
              ) : !user ? (
                signInForm
              ) : (
                signedIn
              )
            ) : availability === 'loading' ? (
              <div className="notice" role="status">
                <LoaderCircle className="spin" />
                <p>Checking registration availability…</p>
              </div>
            ) : !active ? (
              <>
                <div className="notice">
                  <LockKeyhole />
                  <div>
                    <b>
                      {availability === 'closed'
                        ? 'Registration is closed'
                        : availability === 'unavailable'
                          ? 'Registration is temporarily unavailable'
                          : 'Registration opens soon'}
                    </b>
                    <p>
                      {availability === 'closed'
                        ? 'The entry deadline has passed. You can still check an existing entry below.'
                        : availability === 'unavailable'
                          ? 'Please try again later or contact the organising team.'
                          : 'Preview the form while payment details are finalised.'}
                    </p>
                  </div>
                </div>
                {availability === 'upcoming' && (
                  <button
                    className="button"
                    onClick={() => {
                      setPreview(true);
                      setStep(1);
                    }}
                  >
                    Preview {chosen} KM registration <ArrowRight size={17} />
                  </button>
                )}
              </>
            ) : authChecking ? (
              <div className="notice" role="status">
                <LoaderCircle className="spin" />
                <p>Checking your sign-in…</p>
              </div>
            ) : !user ? (
              signInForm
            ) : (
              <form className="registration-form" onSubmit={redeem}>
                {signedIn}
                <div className="form-field">
                  <label htmlFor="station-code">Station invitation code</label>
                  <input
                    id="station-code"
                    type="password"
                    autoComplete="off"
                    maxLength={128}
                    value={code}
                    onChange={(event) => setCode(event.target.value)}
                    required
                    placeholder="Code shared by the organising team"
                  />
                  <small>
                    Use the code circulated within Air Force Station Suratgarh.
                  </small>
                </div>
                <button className="button" disabled={busy} type="submit">
                  Verify station access {spinner}
                </button>
              </form>
            )}
            {!statusMode && (
              <div className="registration-mode-switch">
                <span>Already submitted an entry?</span>
                <button
                  type="button"
                  className="plain-button"
                  onClick={() => switchView('status')}
                >
                  Check my entry <ArrowRight size={16} />
                </button>
              </div>
            )}
          </>
        )}

        {!statusMode && step === 1 && (
          <form className="registration-form" onSubmit={nextDetails}>
            <Choice
              label="Participant type"
              name="participant-type"
              value={details.participant_type}
              options={participantOptions}
              onChange={(value) => set('participant_type', value)}
            />
            <div className="form-grid">
              {[
                [
                  'full_name',
                  'Full name',
                  'text',
                  'name',
                  'Name for your event record and certificate',
                ],
                [
                  'mobile',
                  'Mobile number',
                  'tel',
                  'tel',
                  '10-digit mobile number',
                ],
                ['dob', 'Date of birth', 'date', 'bday', ''],
                [
                  'emergency_contact',
                  'Emergency contact number',
                  'tel',
                  'off',
                  'Another person’s mobile number',
                ],
                ['city', 'City', 'text', 'address-level2', 'Your city'],
              ].map(([field, label, type, autocomplete, placeholder]) => (
                <div
                  className={`form-field ${field === 'full_name' ? 'wide' : ''}`}
                  key={field}
                >
                  <label htmlFor={field}>
                    {label} <span>*</span>
                  </label>
                  <input
                    id={field}
                    value={details[field as keyof Details]}
                    onChange={(event) =>
                      set(field as keyof Details, event.target.value)
                    }
                    type={type}
                    inputMode={type === 'tel' ? 'numeric' : undefined}
                    autoComplete={autocomplete}
                    placeholder={placeholder}
                    required
                    maxLength={type === 'tel' ? 10 : 100}
                    minLength={field === 'full_name' ? 2 : undefined}
                    pattern={type === 'tel' ? '[6-9][0-9]{9}' : undefined}
                    max={type === 'date' ? today : undefined}
                    min={type === 'date' ? '1920-01-01' : undefined}
                  />
                </div>
              ))}
              <Choice
                label="Gender"
                name="gender"
                value={details.gender}
                options={genderOptions}
                onChange={(value) => set('gender', value)}
              />
              <Choice
                label="T-shirt size"
                name="tshirt"
                value={details.tshirt}
                options={['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL']}
                onChange={(value) => set('tshirt', value)}
                hint="tshirt-size-help"
              />
              <Choice
                label="Blood group"
                name="blood-group"
                value={details.blood_group}
                options={[
                  'A+',
                  'A-',
                  'B+',
                  'B-',
                  'AB+',
                  'AB-',
                  'O+',
                  'O-',
                  'Unknown',
                ]}
                onChange={(value) => set('blood_group', value)}
              />
            </div>
            <div id="tshirt-size-help" className="size-guide-note">
              <Info size={18} aria-hidden="true" />
              <p>
                <b>Size guide pending.</b> For sizing advice, call{' '}
                <OrganiserContacts /> before submitting.
              </p>
            </div>
            <p className="privacy-hint">
              A parent or guardian must register children. Station eligibility
              rules apply.
            </p>
            <div className="form-actions">
              <button
                type="button"
                className="plain-button"
                onClick={() => {
                  setPreview(false);
                  setStep(0);
                }}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button type="submit" className="button">
                {preview ? 'Payment preview' : 'Continue to payment'}{' '}
                <ArrowRight size={17} />
              </button>
            </div>
          </form>
        )}

        {!statusMode && step === 2 && (
          <div className="registration-form">
            {!preview && !active ? (
              <div className="notice" role="status">
                <Info />
                <div>
                  <b>
                    {availability === 'closed'
                      ? 'New entries are now closed'
                      : 'Payment is temporarily unavailable'}
                  </b>
                  <p>
                    Please do not make a payment. If you have already paid, keep
                    your receipt and call <OrganiserContacts />.
                  </p>
                </div>
              </div>
            ) : paymentToolsEnabled && config?.payment_qr_url ? (
              <div className="payment-instructions">
                <img
                  src={config.payment_qr_url}
                  alt="Suratgarh event payment QR code"
                />
                <div>
                  <span className="eyebrow">PAY THE EXACT AMOUNT</span>
                  <strong>{feeLabel(chosen)}</strong>
                  <p>{config.payee_name}</p>
                  <small>{config.upi_id}</small>
                  <p>
                    Check the payee in your UPI app before confirming payment.
                  </p>
                  <div className="registration-mode-switch">
                    <button
                      type="button"
                      className="plain-button"
                      disabled={busy || !paymentToolsEnabled}
                      onClick={() => void copyPaymentValue('upi')}
                      aria-label={`Copy UPI ID for ${config.payee_name}`}
                    >
                      <Copy size={16} aria-hidden="true" /> Copy UPI ID
                    </button>
                    <button
                      type="button"
                      className="plain-button"
                      disabled={busy || !paymentToolsEnabled}
                      onClick={() => void copyPaymentValue('amount')}
                      aria-label={`Copy amount of ${confirmedAmount} rupees`}
                    >
                      <Copy size={16} aria-hidden="true" /> Copy amount
                    </button>
                    <button
                      type="button"
                      className="plain-button"
                      disabled={busy || !paymentToolsEnabled}
                      onClick={() => void savePaymentQR()}
                      aria-label={`Save QR for ${config.payee_name}`}
                    >
                      <Download size={16} aria-hidden="true" /> Save QR
                    </button>
                  </div>
                  <output
                    className="privacy-hint"
                    aria-live="polite"
                    aria-atomic="true"
                  >
                    {paymentFeedback?.context === paymentContext
                      ? paymentFeedback.text
                      : ''}
                  </output>
                </div>
              </div>
            ) : (
              <div className="placeholder-payment">
                <div>
                  <img
                    src={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/assets/payment-placeholder.svg`}
                    alt="Sample QR code. Not for payment."
                  />
                  <strong>YET TO UPDATE</strong>
                </div>
                <div>
                  <b>Payment QR pending</b>
                  <p>This sample code cannot request a payment.</p>
                </div>
              </div>
            )}
            <div className="form-field">
              <label htmlFor="transaction-id">
                Transaction / UTR reference {!preview && <span>*</span>}
              </label>
              <input
                id="transaction-id"
                value={details.transaction_id}
                onChange={(event) => set('transaction_id', event.target.value)}
                autoComplete="off"
                spellCheck={false}
                maxLength={64}
                placeholder={
                  preview
                    ? 'Optional in preview'
                    : 'Reference from your payment app'
                }
              />
            </div>
            <label className="upload-zone" htmlFor="receipt">
              <UploadCloud size={29} />
              <b>
                {file
                  ? 'Replace payment screenshot'
                  : 'Choose a payment screenshot'}
              </b>
              <span>
                {preview ? 'Optional in preview · ' : ''}JPG or PNG · Up to 5 MB
              </span>
              <input
                id="receipt"
                type="file"
                accept="image/jpeg,image/png"
                onChange={(event) => {
                  selectFile(event.currentTarget.files?.[0]);
                  event.currentTarget.value = '';
                }}
              />
            </label>
            {file && (
              <div className="uploaded-file">
                <img src={fileUrl} alt="Your selected payment screenshot" />
                <span>
                  <b>{file.name}</b>
                  <small>
                    {(file.size / 1024).toFixed(0)} KB ·{' '}
                    {preview ? 'Preview only' : 'Ready for submission'}
                  </small>
                </span>
                <button
                  className="plain-button"
                  aria-label="Remove screenshot"
                  onClick={() => setFile(null)}
                >
                  <X size={18} />
                </button>
              </div>
            )}
            <p className="privacy-hint">
              <LockKeyhole size={14} />
              {preview
                ? 'Preview screenshots are not uploaded.'
                : 'Show the transaction details clearly. Your screenshot is stored privately for verification.'}
            </p>
            <div className="form-actions">
              <button className="plain-button" onClick={() => setStep(1)}>
                <ArrowLeft size={16} /> Back
              </button>
              <button
                className="button"
                onClick={() => {
                  if (
                    !preview &&
                    (!file ||
                      !/^[A-Za-z0-9-]{6,64}$/.test(
                        details.transaction_id.trim(),
                      ))
                  ) {
                    setError(
                      'Add a payment screenshot and a valid transaction reference (6–64 letters, digits or hyphens).',
                    );
                    return;
                  }
                  setStep(3);
                }}
              >
                Review entry <ArrowRight size={17} />
              </button>
            </div>
          </div>
        )}

        {!statusMode && step === 3 && (
          <div className="registration-form">
            <dl className="review-details">
              {[
                ['Participant', details.full_name],
                [
                  'Registering as',
                  participantOptions.find(
                    (option) => option.value === details.participant_type,
                  )?.label || '—',
                ],
                ['Mobile', details.mobile],
                [
                  'Email',
                  user?.email || 'Sign-in required when registration opens',
                ],
                [
                  'Date of birth',
                  new Date(`${details.dob}T12:00:00`).toLocaleDateString(
                    'en-IN',
                    { day: 'numeric', month: 'short', year: 'numeric' },
                  ),
                ],
                [
                  'Gender',
                  genderOptions.find(
                    (option) => option.value === details.gender,
                  )?.label || '—',
                ],
                ['City', details.city],
                ['Race', `${chosen} KM · ${raceNames[chosen]}`],
                ['T-shirt size', details.tshirt],
                ['Blood group', details.blood_group],
                ['Emergency contact', details.emergency_contact],
                ['Amount', feeLabel(chosen)],
                [
                  'Transaction reference',
                  details.transaction_id || 'Not added (preview)',
                ],
                ['Screenshot', file?.name || 'Not added (preview)'],
              ].map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
            <div className="consent-row">
              <Checkbox
                id="consent"
                checked={consent}
                onCheckedChange={(value) => setConsent(!!value)}
              />
              <label htmlFor="consent">
                I confirm the participant details are correct, I am authorised
                to register this participant, and I agree to the{' '}
                <button type="button" onClick={() => onPolicy('terms')}>
                  Terms & Conditions
                </button>
                ,{' '}
                <button type="button" onClick={() => onPolicy('privacy')}>
                  Privacy Policy
                </button>{' '}
                and{' '}
                <button type="button" onClick={() => onPolicy('refund')}>
                  Refund Policy
                </button>
                .
              </label>
            </div>
            {!preview && !active && (
              <div className="notice" role="status">
                <Info />
                <p>
                  New entries are{' '}
                  {availability === 'closed'
                    ? 'now closed'
                    : 'temporarily unavailable'}
                  . If you have already paid, keep your receipt and contact{' '}
                  <OrganiserContacts />. Do not pay again.
                </p>
              </div>
            )}
            <div className="form-actions">
              <button
                className="plain-button"
                onClick={() => setStep(2)}
                disabled={busy}
              >
                <ArrowLeft size={16} /> Back
              </button>
              <button
                className="button"
                disabled={preview || busy || !consent || !active}
                onClick={submit}
              >
                Submit for verification {spinner}
              </button>
            </div>
            {preview && (
              <button type="button" className="plain-button" onClick={onClose}>
                Finish preview
              </button>
            )}
          </div>
        )}

        {!statusMode && step === 4 && result && (
          <div className="submitted">
            <FileCheck2 size={48} />
            <span className="status-chip">
              {result.payment_status === 'verified'
                ? 'PAYMENT VERIFIED'
                : result.payment_status === 'rejected'
                  ? 'PAYMENT NEEDS ATTENTION'
                  : 'PAYMENT PENDING REVIEW'}
            </span>
            <h3>Thank you, {details.full_name.split(' ')[0]}.</h3>
            <p>
              {result.payment_status === 'verified'
                ? `Your ${chosen} KM entry is confirmed. Payment verified.`
                : result.payment_status === 'rejected'
                  ? 'Your entry was received, but the payment could not be verified. Open your entries to submit a corrected payment reference and screenshot.'
                  : `Your ${chosen} KM entry awaits payment verification. The organising team will confirm it after review.`}
            </p>
            <div>
              <small>YOUR REGISTRATION REFERENCE</small>
              <code>{result.registration_id}</code>
            </div>
            <p>
              Keep this reference and your payment receipt. View your entries
              below to check the payment status.
            </p>
            <button className="button" onClick={() => switchView('status')}>
              View my entries <ArrowRight size={17} />
            </button>
            <button type="button" className="plain-button" onClick={onClose}>
              Return to event
            </button>
          </div>
        )}

        {step === 0 && statusMode && user && (
          <section
            className="owner-entries"
            aria-labelledby="owner-entries-title"
          >
            <div className="owner-entries-heading">
              <h3 id="owner-entries-title">Your submitted entries</h3>
              <button
                type="button"
                className="plain-button"
                disabled={entriesLoading}
                onClick={() => setEntriesRevision((current) => current + 1)}
              >
                {entriesLoading ? 'Refreshing…' : 'Refresh status'}
              </button>
            </div>
            {entriesLoading ? (
              <p className="notice" role="status">
                <LoaderCircle className="spin" size={18} /> Loading your
                entries…
              </p>
            ) : entriesError ? (
              <p className="form-error" role="alert">
                {entriesError}
              </p>
            ) : entries.length === 0 ? (
              <div className="notice">
                <Info />
                <div>
                  <b>No submitted entries for this email</b>
                  <p>
                    Try the email used for your registration. If you paid but
                    did not finish submitting, keep your receipt and call{' '}
                    <OrganiserContacts /> before paying again.
                  </p>
                </div>
              </div>
            ) : (
              entries.map((entry) => (
                <article key={entry.id} className="owner-entry">
                  <b>{entry.full_name}</b>
                  <span>
                    {entry.race} KM · {raceNames[entry.race]}
                  </span>
                  <span className={`entry-status ${entry.payment_status}`}>
                    {entry.payment_status === 'verified'
                      ? 'Payment verified · Entry confirmed'
                      : entry.payment_status === 'rejected'
                        ? 'Payment needs attention · Contact organisers'
                        : 'Payment pending verification'}
                  </span>
                  <div className="entry-reference">
                    <small>Registration reference</small>
                    <code>{entry.id}</code>
                  </div>
                  {entry.payment_status === 'rejected' && (
                    <div className="entry-support">
                      <p>
                        The original proof could not be verified. If you have a
                        corrected payment reference and a new screenshot, submit
                        replacement proof below. Your original proof remains on
                        record.
                      </p>
                      {correctionEntryId === entry.id ? (
                        <form
                          className="payment-correction"
                          onSubmit={(event) =>
                            void submitPaymentCorrection(event, entry)
                          }
                        >
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
                          <label className="upload-zone" htmlFor={`replacement-proof-${entry.id}`}>
                            <UploadCloud size={25} />
                            <b>
                              {correctionFile
                                ? correctionFile.name
                                : 'Add a new payment screenshot'}
                            </b>
                            <span>JPG or PNG · maximum 5 MB</span>
                            <input
                              accept="image/jpeg,image/png"
                              disabled={correctionBusy}
                              id={`replacement-proof-${entry.id}`}
                              onChange={(event) =>
                                selectCorrectionFile(event.target.files?.[0])
                              }
                              required
                              type="file"
                            />
                          </label>
                          {correctionError && (
                            <p className="form-error" role="alert">
                              {correctionError}
                            </p>
                          )}
                          <p className="payment-correction-note">
                            Do not make another payment just to retry this form.
                          </p>
                          <div className="payment-correction-actions">
                            <button
                              className="button"
                              disabled={correctionBusy || !correctionFile}
                            >
                              Submit replacement proof {correctionBusy ? <LoaderCircle className="spin" size={17} /> : <ArrowRight size={17} />}
                            </button>
                            <button
                              className="plain-button"
                              disabled={correctionBusy}
                              onClick={resetPaymentCorrection}
                              type="button"
                            >
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : (
                        <button
                          className="plain-button entry-correction-trigger"
                          onClick={() => beginPaymentCorrection(entry.id)}
                          type="button"
                        >
                          Update payment proof <ArrowRight size={16} />
                        </button>
                      )}
                    </div>
                  )}
                </article>
              ))
            )}
            {correctionMessage && (
              <p className="form-message" role="status">
                {correctionMessage}
              </p>
            )}
            {entries.length > 0 && !entriesLoading && !entriesError && (
              <p className="privacy-hint">
                Your entry is confirmed only when the status shows “Payment
                verified”.
              </p>
            )}
          </section>
        )}
        {step === 0 && statusMode && (
          <div className="registration-mode-switch">
            <button
              type="button"
              className="plain-button"
              disabled={busy}
              onClick={() =>
                onChooseRace ? onChooseRace() : switchView('register')
              }
            >
              <ArrowLeft size={16} />{' '}
              {onChooseRace
                ? 'Choose a race'
                : active
                  ? 'Register another participant'
                  : 'Back to registration'}
            </button>
            <button type="button" className="plain-button" onClick={onClose}>
              Return to event
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
