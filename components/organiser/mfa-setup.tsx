'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { KeyRound, LoaderCircle, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import './mfa-setup.css';

export type OrganiserMfaAssurance = 'unknown' | 'aal1' | 'aal2';

type MfaScreen = 'checking' | 'setup' | 'challenge' | 'verified' | 'unavailable';

type TotpEnrollment = {
  factorId: string;
  qrCode: string;
};

type TotpFactor = {
  id: string;
  status: 'verified' | 'unverified';
};

function messageFor(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'The secure sign-in check could not be completed. Please try again.';
}

function sixDigits(value: string) {
  return value.replace(/\D/g, '').slice(0, 6);
}

/**
 * A narrow, client-side TOTP step-up for organiser desks. The Supabase session
 * is promoted by Auth itself; the desk still relies on database AAL2 policies.
 */
export function OrganiserMfaSetup({
  userId,
  onAssuranceChange,
}: {
  userId: string;
  onAssuranceChange: (assurance: OrganiserMfaAssurance) => void;
}) {
  const [screen, setScreen] = useState<MfaScreen>('checking');
  const [factorId, setFactorId] = useState<string | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const codeId = useId();
  const requestVersion = useRef(0);

  const inspectAssurance = useCallback(async () => {
    const request = requestVersion.current + 1;
    requestVersion.current = request;
    setBusy(false);
    setMessage('');

    try {
      if (!supabase) {
        setScreen('unavailable');
        onAssuranceChange('unknown');
        return;
      }

      setScreen('checking');
      const { data: assurance, error: assuranceError } =
        await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
      if (request !== requestVersion.current) return;

      if (assuranceError) {
        setScreen('unavailable');
        setMessage(messageFor(assuranceError));
        onAssuranceChange('unknown');
        return;
      }

      if (assurance?.currentLevel === 'aal2') {
        setScreen('verified');
        setEnrollment(null);
        setFactorId(null);
        onAssuranceChange('aal2');
        return;
      }

      onAssuranceChange('aal1');
      const { data: factors, error: factorsError } =
        await supabase.auth.mfa.listFactors();
      if (request !== requestVersion.current) return;

      if (factorsError) {
        setScreen('unavailable');
        setMessage(messageFor(factorsError));
        onAssuranceChange('unknown');
        return;
      }

      const verifiedFactor = (factors?.totp as TotpFactor[] | undefined)?.find(
        (factor) => factor.status === 'verified',
      );

      setEnrollment(null);
      setCode('');
      setFactorId(verifiedFactor?.id ?? null);
      setScreen(verifiedFactor ? 'challenge' : 'setup');
    } catch (error) {
      if (request !== requestVersion.current) return;
      setScreen('unavailable');
      setMessage(messageFor(error));
      onAssuranceChange('unknown');
    }
  }, [onAssuranceChange]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void inspectAssurance();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      requestVersion.current += 1;
    };
  }, [inspectAssurance, userId]);

  async function beginEnrollment() {
    if (!supabase) {
      setScreen('unavailable');
      onAssuranceChange('unknown');
      return;
    }

    const request = requestVersion.current + 1;
    requestVersion.current = request;
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Desert Braves organiser',
        issuer: 'Desert Braves',
      });
      if (request !== requestVersion.current) return;
      setBusy(false);

      if (error || !data || data.type !== 'totp') {
        setMessage(messageFor(error));
        return;
      }

      setFactorId(data.id);
      setEnrollment({ factorId: data.id, qrCode: data.totp.qr_code });
      setCode('');
      setScreen('challenge');
    } catch (error) {
      if (request !== requestVersion.current) return;
      setBusy(false);
      setMessage(messageFor(error));
    }
  }

  async function verifyCode() {
    if (!supabase || !factorId) return;
    if (code.length !== 6) {
      setMessage('Enter the six-digit code from your authenticator app.');
      return;
    }

    const request = requestVersion.current + 1;
    requestVersion.current = request;
    setBusy(true);
    setMessage('');
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      if (request !== requestVersion.current) return;
      setBusy(false);

      if (error) {
        setMessage(messageFor(error));
        return;
      }

      setCode('');
      setEnrollment(null);
      setMessage('Multi-factor sign-in confirmed. Opening the protected desk…');
      await inspectAssurance();
    } catch (error) {
      if (request !== requestVersion.current) return;
      setBusy(false);
      setMessage(messageFor(error));
    }
  }

  if (screen === 'unavailable') {
    return (
      <section className="organiser-mfa organiser-mfa--unavailable" aria-live="polite">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>Multi-factor sign-in is not ready in this build.</strong>
          <p>
            Organiser records remain locked until the private event service is configured.
          </p>
          {message && <p className="organiser-mfa__message" role="alert">{message}</p>}
        </div>
      </section>
    );
  }

  if (screen === 'checking') {
    return (
      <section className="organiser-mfa organiser-mfa--checking" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="organiser-mfa__spin" size={19} />
        Checking multi-factor sign-in…
      </section>
    );
  }

  if (screen === 'verified') {
    return (
      <section className="organiser-mfa organiser-mfa--verified" aria-live="polite">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>Multi-factor sign-in confirmed</strong>
          <p>Protected organiser records can be opened for this session.</p>
        </div>
      </section>
    );
  }

  const isEnrollment = Boolean(enrollment);

  return (
    <section className="organiser-mfa" aria-labelledby="organiser-mfa-title">
      <div className="organiser-mfa__heading">
        <KeyRound aria-hidden="true" size={21} />
        <div>
          <span>Required before organiser access</span>
          <h3 id="organiser-mfa-title">
            {isEnrollment ? 'Add this account to your authenticator app' : 'Complete multi-factor sign-in'}
          </h3>
          <p>
            A six-digit code protects payment and T-shirt collection records.
          </p>
        </div>
      </div>

      {screen === 'setup' ? (
        <div className="organiser-mfa__start">
          <Smartphone aria-hidden="true" size={22} />
          <div>
            <strong>Set up an authenticator app</strong>
            <p>
              Use an app that creates time-based, six-digit codes. You will scan a code, then verify it here.
            </p>
          </div>
          <button disabled={busy} onClick={() => void beginEnrollment()} type="button">
            {busy ? <LoaderCircle aria-hidden="true" className="organiser-mfa__spin" size={17} /> : <ShieldCheck aria-hidden="true" size={17} />}
            {busy ? 'Preparing…' : 'Set up authenticator'}
          </button>
        </div>
      ) : (
        <form
          className="organiser-mfa__challenge"
          onSubmit={(event) => {
            event.preventDefault();
            void verifyCode();
          }}
        >
          {enrollment && (
            <div className="organiser-mfa__qr">
              {/* oxlint-disable-next-line next/no-img-element -- Supabase returns this short-lived SVG only for the signed-in organiser's TOTP enrolment. */}
              <img
                alt="Authenticator app setup QR code"
                height="168"
                src={`data:image/svg+xml;utf-8,${encodeURIComponent(enrollment.qrCode)}`}
                width="168"
              />
              <p>Scan this code in your authenticator app. It is shown only while you complete setup.</p>
            </div>
          )}
          <label htmlFor={codeId}>
            <span>Authenticator code</span>
            <input
              autoComplete="one-time-code"
              id={codeId}
              inputMode="numeric"
              maxLength={6}
              onChange={(event) => setCode(sixDigits(event.target.value))}
              pattern="[0-9]{6}"
              placeholder="000000"
              required
              value={code}
            />
          </label>
          <button disabled={busy || code.length !== 6} type="submit">
            {busy ? <LoaderCircle aria-hidden="true" className="organiser-mfa__spin" size={17} /> : <ShieldCheck aria-hidden="true" size={17} />}
            {busy ? 'Checking…' : 'Verify and continue'}
          </button>
          {!enrollment && (
            <button className="organiser-mfa__restart" disabled={busy} onClick={() => void inspectAssurance()} type="button">
              <RefreshCw aria-hidden="true" size={16} />
              Check multi-factor status again
            </button>
          )}
        </form>
      )}

      {message && <p className="organiser-mfa__message" role="alert">{message}</p>}
    </section>
  );
}
