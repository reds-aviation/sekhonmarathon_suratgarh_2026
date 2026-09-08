'use client';

import { useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CreditCard,
  IndianRupee,
  Mail,
  Monitor,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';

type Answer = 'yes' | 'no' | null;

const registrationSteps = [
  {
    title: 'Connect to AFNET',
    copy: 'Use an AFNET-connected computer. The official portal is not available on the public internet.',
  },
  {
    title: 'Open AFND',
    copy: 'Enter www.afnd.iaf.in in the browser on AFNET.',
  },
  {
    title: 'Open the marathon link',
    copy: 'Select Sekhon Marathon Registration from the pop-up window.',
  },
  {
    title: 'Select HQ WAC',
    copy: 'Scroll down to HQ WAC and choose the registration option.',
  },
  {
    title: 'Complete the form',
    copy: 'Enter the participant details requested on the official registration page.',
  },
  {
    title: 'Pay at Sports Section',
    copy: 'During normal working hours, pay the applicable fee through the SI POS machine at Sports Section and retain the SI POS receipt.',
  },
  {
    title: 'Confirm the payment',
    copy: 'Enter the SI POS receipt number and required payment-confirmation details on the official AFNET portal. Retain the official acknowledgement.',
  },
] as const;

const registrationPath = ['AFNET', 'AFND', 'HQ WAC', 'Register & pay'] as const;

export function RegistrationGuide({
  onChooseRace,
  onOpenEventGuide,
}: {
  onChooseRace: () => void;
  onOpenEventGuide: () => void;
}) {
  const [registered, setRegistered] = useState<Answer>(null);
  const [paid, setPaid] = useState<Answer>(null);
  const [paymentConfirmed, setPaymentConfirmed] = useState<Answer>(null);

  function answerRegistration(answer: Exclude<Answer, null>) {
    setRegistered(answer);
    if (answer === 'no') {
      setPaid(null);
      setPaymentConfirmed(null);
    }
  }

  function answerPayment(answer: Exclude<Answer, null>) {
    setPaid(answer);
    if (answer === 'no') setPaymentConfirmed(null);
  }

  function resetCheck() {
    setRegistered(null);
    setPaid(null);
    setPaymentConfirmed(null);
  }

  return (
    <main id="main" className="app-view registration-guide" tabIndex={-1}>
      <header className="app-view-header registration-guide-header">
        <p className="app-kicker">Official registration route</p>
        <h1 tabIndex={-1}>How to register</h1>
        <p>
          Registration is completed on the official internal portal from an
          AFNET-connected system.
        </p>
        <p className="registration-deadline">
          Complete registration by <strong>Sunday, 27 September 2026</strong>.
        </p>
      </header>

      <nav className="registration-path" aria-label="Registration path summary">
        {registrationPath.map((step, index) => (
          <span className="registration-path-step" key={step}>
            <span>{step}</span>
            {index < registrationPath.length - 1 && (
              <ArrowRight size={15} aria-hidden="true" />
            )}
          </span>
        ))}
      </nav>

      <section className="registration-steps-panel" aria-labelledby="afnet-steps-title">
        <div className="registration-section-heading">
          <Monitor size={22} aria-hidden="true" />
          <div>
            <p>On an AFNET computer</p>
            <h2 id="afnet-steps-title">Follow these seven steps</h2>
          </div>
        </div>
        <ol className="registration-timeline">
          {registrationSteps.map((step, index) => (
            <li key={step.title}>
              <span aria-hidden="true">{index + 1}</span>
              <div>
                <h3>{step.title}</h3>
                <p>
                  {step.title === 'Open AFND' ? (
                    <>
                      Enter <code>www.afnd.iaf.in</code> in the browser on AFNET.
                    </>
                  ) : (
                    step.copy
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
        <p className="registration-family-note">
          For an eligible family participant, the Airwarrior completes the
          registration through AFNET.
        </p>
      </section>

      <section className="registration-payment" aria-labelledby="payment-title">
        <div className="registration-section-heading">
          <CreditCard size={22} aria-hidden="true" />
          <div>
            <p>Current payment method</p>
            <h2 id="payment-title">Pay through the SI POS machine</h2>
          </div>
        </div>
        <p>
          Visit <strong>Sports Section</strong> during normal working hours
          after completing the official form. Pay through the SI POS machine,
          retain the SI POS receipt, then enter its receipt number and the
          required payment-confirmation details on the official AFNET portal.
          A QR option may be added only after it is authorised.
        </p>
        <dl className="registration-fees">
          <div>
            <dt>5 KM</dt>
            <dd><IndianRupee size={15} aria-hidden="true" />200</dd>
          </div>
          <div>
            <dt>10 KM</dt>
            <dd><IndianRupee size={15} aria-hidden="true" />250</dd>
          </div>
          <div>
            <dt>21 KM</dt>
            <dd><IndianRupee size={15} aria-hidden="true" />250</dd>
          </div>
        </dl>
      </section>

      <section className="registration-check" aria-labelledby="registration-check-title">
        <div className="registration-section-heading">
          <CheckCircle2 size={22} aria-hidden="true" />
          <div>
            <p>Private readiness check</p>
            <h2 id="registration-check-title">Have you completed all three steps?</h2>
          </div>
        </div>
        <p className="registration-privacy">
          This is a self-reported checklist. Your answers stay on this screen
          and are not sent or stored.
        </p>

        <fieldset>
          <legend>Have you completed the participant registration form on AFNET?</legend>
          <div className="registration-answer-row">
            <button
              type="button"
              className={registered === 'yes' ? 'is-selected' : ''}
              aria-pressed={registered === 'yes'}
              onClick={() => answerRegistration('yes')}
            >
              Yes
            </button>
            <button
              type="button"
              className={registered === 'no' ? 'is-selected' : ''}
              aria-pressed={registered === 'no'}
              onClick={() => answerRegistration('no')}
            >
              No
            </button>
          </div>
        </fieldset>

        {registered === 'no' && (
          <output className="registration-result is-action">
            <Monitor size={20} aria-hidden="true" />
            <p>
              Use an AFNET-connected computer and follow the seven steps above.
              Complete the participant form before making the payment. For an
              eligible family participant, the Airwarrior completes this step
              through AFNET.
            </p>
          </output>
        )}

        {registered === 'yes' && (
          <fieldset>
            <legend>Have you paid the applicable fee at Sports Section?</legend>
            <div className="registration-answer-row">
              <button
                type="button"
                className={paid === 'yes' ? 'is-selected' : ''}
                aria-pressed={paid === 'yes'}
                onClick={() => answerPayment('yes')}
              >
                Yes
              </button>
              <button
                type="button"
                className={paid === 'no' ? 'is-selected' : ''}
                aria-pressed={paid === 'no'}
                onClick={() => answerPayment('no')}
              >
                No
              </button>
            </div>
          </fieldset>
        )}

        {registered === 'yes' && paid === 'no' && (
          <output className="registration-result is-action">
            <CreditCard size={20} aria-hidden="true" />
            <p>
              Pay at Sports Section through the SI POS machine during normal
              working hours. Retain the SI POS receipt, then enter its receipt
              number and payment-confirmation details on the official AFNET
              portal.
            </p>
          </output>
        )}

        {registered === 'yes' && paid === 'yes' && (
          <fieldset>
            <legend>
              Have you entered the receipt and payment-confirmation details in
              the official internal portal?
            </legend>
            <div className="registration-answer-row">
              <button
                type="button"
                className={paymentConfirmed === 'yes' ? 'is-selected' : ''}
                aria-pressed={paymentConfirmed === 'yes'}
                onClick={() => setPaymentConfirmed('yes')}
              >
                Yes
              </button>
              <button
                type="button"
                className={paymentConfirmed === 'no' ? 'is-selected' : ''}
                aria-pressed={paymentConfirmed === 'no'}
                onClick={() => setPaymentConfirmed('no')}
              >
                No
              </button>
            </div>
          </fieldset>
        )}

        {registered === 'yes' && paid === 'yes' && paymentConfirmed === 'no' && (
          <output className="registration-result is-action">
            <Monitor size={20} aria-hidden="true" />
            <p>
              Enter the SI POS receipt number and payment-confirmation details
              on the official internal portal. Retain the SI POS receipt and
              the acknowledgement it provides.
            </p>
          </output>
        )}

        {registered === 'yes' && paid === 'yes' && paymentConfirmed === 'yes' && (
          <output className="registration-result is-complete">
            <CheckCircle2 size={20} aria-hidden="true" />
            <p>
              Based on your answers, you have completed the required
              registration steps. Retain your payment receipt and official
              portal confirmation. Final payment verification is carried out by
              the organisers against the submitted internal records.
            </p>
          </output>
        )}

        {(registered !== null || paid !== null || paymentConfirmed !== null) && (
          <button type="button" className="registration-reset" onClick={resetCheck}>
            <RotateCcw size={15} aria-hidden="true" /> Start again
          </button>
        )}
      </section>

      <aside className="registration-help-note">
        <Monitor size={19} aria-hidden="true" />
        <p>
          For registration or payment assistance, visit Station Sports Section.
        </p>
      </aside>

      <aside className="registration-certificate-note">
        <Mail size={21} aria-hidden="true" />
        <div>
          <h2>Digital certificate</h2>
          <p>
            Enter your name and email carefully on the official form. After
            race completion is confirmed, the certificate can be sent to that
            registered email address.
          </p>
        </div>
      </aside>

      <aside className="registration-safety-note">
        <ShieldCheck size={18} aria-hidden="true" />
        <p>
          This public website does not verify or store registration or payment
          information. It does not link into the internal network.
        </p>
      </aside>

      <div className="guide-actions registration-guide-actions">
        <button className="s-button" onClick={onChooseRace}>
          View race options <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button className="s-button s-button--secondary" onClick={onOpenEventGuide}>
          Read the event guide
        </button>
      </div>
    </main>
  );
}
