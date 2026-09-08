'use client';

import { useState } from 'react';
import {
  ArrowRight,
  Award,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  Clock3,
  CupSoda,
  ListChecks,
  MapPin,
  Medal,
  Phone,
  Share2,
  ShieldCheck,
  Shirt,
} from 'lucide-react';
import { RouteTimeline } from '@/components/route-timeline';
import type { RouteDistance } from '@/lib/route-selection';

export function EventGuide({
  onChooseRace,
  onHowToRegister,
  selectedRoute,
  onSelectRoute,
}: {
  onChooseRace: () => void;
  onHowToRegister: () => void;
  selectedRoute?: RouteDistance;
  onSelectRoute?: (distance: RouteDistance) => void;
}) {
  const [shareStatus, setShareStatus] = useState('');

  async function shareEvent() {
    const eventUrl = new URL(
      import.meta.env.BASE_URL,
      window.location.origin,
    ).href;
    const shareData = {
      title: 'Sekhon IAF Marathon 2026 · Suratgarh',
      text: 'Sekhon IAF Marathon at Air Force Station Suratgarh on 4 October 2026, for airwarriors and families.',
      url: eventUrl,
    };

    if (navigator.share) {
      try {
        await navigator.share(shareData);
        setShareStatus('Share options opened.');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setShareStatus('Use your browser’s Share option to send this page.');
      }
      return;
    }

    try {
      await navigator.clipboard.writeText(eventUrl);
      setShareStatus('Event link copied.');
    } catch {
      setShareStatus('Use your browser’s Share option to send this page.');
    }
  }

  return (
    <main id="main" className="app-view guide-view" tabIndex={-1}>
      <header className="guide-header">
        <p className="guide-kicker">Plan your morning</p>
        <h1 tabIndex={-1}>Event guide</h1>
        <p className="guide-intro">
          The key information for registration, collection and race day.
        </p>
      </header>

      <ul className="guide-essentials" aria-label="Event essentials">
        <li>
          <CalendarDays size={18} aria-hidden="true" />
          <span>Sunday, 4 October 2026</span>
        </li>
        <li>
          <Clock3 size={18} aria-hidden="true" />
          <span>Reporting and flag-off timings to be announced</span>
        </li>
        <li>
          <ShieldCheck size={18} aria-hidden="true" />
          <span>Airwarriors &amp; families only</span>
        </li>
      </ul>

      <section className="guide-announcement" aria-labelledby="guide-announcement-title">
        <span>Registration deadline</span>
        <div>
          <h2 id="guide-announcement-title">Sunday, 27 September 2026</h2>
          <button type="button" onClick={onHowToRegister}>
            How to register <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      </section>

      <section
        className="guide-collection"
        id="guide-kit"
        aria-labelledby="collection-title"
      >
        <div className="guide-collection-title">
          <Shirt size={23} aria-hidden="true" />
          <h2 id="collection-title" tabIndex={-1}>T-shirt collection</h2>
        </div>
        <p className="guide-collection-date">Saturday, 3 October 2026</p>
        <p className="guide-collection-time">09:00–13:30</p>
        <p className="guide-collection-place">
          <MapPin size={18} aria-hidden="true" />
          <span>In front of SBI Bank, inside the station</span>
        </p>
        <p className="guide-collection-confirmation">
          Please ensure that your registration and payment details have been
          correctly submitted on the official portal.
        </p>
      </section>

      <RouteTimeline
        selectedDistance={selectedRoute}
        onSelectDistance={onSelectRoute}
      />

      <section className="guide-runner-package" aria-labelledby="runner-package-title">
        <div>
          <p className="guide-kicker">For every registered participant</p>
          <h2 id="runner-package-title">Your event essentials</h2>
        </div>
        <ul>
          <li><Shirt size={20} aria-hidden="true" /> Event T-shirt</li>
          <li><Medal size={20} aria-hidden="true" /> Medal</li>
          <li><Award size={20} aria-hidden="true" /> Digital certificate</li>
          <li><CupSoda size={20} aria-hidden="true" /> Refreshments</li>
        </ul>
        <p>
          All registered participants will receive an event T-shirt and medal.
          Certificate communication will be issued by the organisers after race
          completion is confirmed. Use your correct name and email on the
          official form.
        </p>
      </section>

      <details className="guide-group">
        <summary>
          <ListChecks size={21} aria-hidden="true" />
          <span>
            <b>Race-day instructions</b>
            <small>What to know before you arrive</small>
          </span>
          <ChevronDown size={20} aria-hidden="true" />
        </summary>
        <div className="guide-group-body">
          <ul className="guide-kit-list">
            <li>Arrive at the reporting time announced by the organisers.</li>
            <li>Wear comfortable running shoes and bring your station identification.</li>
            <li>Follow the official briefing, course signs and marshals.</li>
            <li>Use the marked hydration and refreshment points.</li>
            <li>Run within your preparation and report any discomfort promptly.</li>
          </ul>
        </div>
      </details>

      <details className="guide-group" id="faqs">
        <summary>
          <ShieldCheck size={21} aria-hidden="true" />
          <span>
            <b>Quick answers</b>
            <small>Registration, payment and collection</small>
          </span>
          <ChevronDown size={20} aria-hidden="true" />
        </summary>
        <div className="guide-group-body guide-quick-answers">
          <h3>Where do I register?</h3>
          <p>On AFNET: AFND → Sekhon Marathon Registration → HQ WAC.</p>

          <h3>When can I pay?</h3>
          <p>
            Payment can be made at Sports Section during normal working hours
            through the SI POS machine.
          </p>

          <h3>What should I keep after payment?</h3>
          <p>
            Retain your payment receipt and <strong>receipt number</strong>.
            Enter the same receipt number/details in the payment-confirmation
            section of the official internal portal.
          </p>

          <h3>How is payment verified?</h3>
          <p>
            The organisers will cross-check the payment record with the payment
            details submitted in the official internal registration portal.
            Ensure that the receipt number/details entered in the portal are
            correct. This public website does not verify payment.
          </p>

          <h3>How do family members register?</h3>
          <p>
            Registration for eligible family members is to be completed by the
            Airwarrior through the official AFNET registration portal.
          </p>

          <h3>When do I collect my T-shirt?</h3>
          <p>
            Saturday, 3 October, from 09:00 to 13:30 in front of SBI Bank
            inside the station.
          </p>

          <h3>Having trouble?</h3>
          <p>
            For any registration, payment or payment-confirmation issue, contact
            the Station Sports Section for assistance.
          </p>

          <h3>What if I have an issue after registration closes?</h3>
          <p>
            Report the matter to the Station Sports Section for clarification.
            Late registration is not guaranteed.
          </p>
        </div>
      </details>

      <section className="guide-save" aria-labelledby="save-event-title">
        <h2 id="save-event-title" tabIndex={-1}>Keep the date handy</h2>
        <p>Save the event dates or share this page with an eligible family member.</p>
        <div className="guide-save-actions">
          <a
            href={`${process.env.NEXT_PUBLIC_BASE_PATH || ''}/sekhon-marathon-2026.ics`}
            download
          >
            <CalendarPlus size={18} aria-hidden="true" /> Add dates
          </a>
          <button type="button" onClick={shareEvent}>
            <Share2 size={18} aria-hidden="true" /> Share event
          </button>
        </div>
        <output className="guide-share-status" aria-live="polite">{shareStatus}</output>
      </section>

      <section
        className="guide-contact-section"
        id="contact"
        aria-labelledby="contact-guide-title"
      >
        <h2 id="contact-guide-title" tabIndex={-1}>Need help?</h2>
        <p className="guide-contact-intro">
          For registration, payment or payment-confirmation help, contact the
          Station Sports Section.
        </p>
        <div className="guide-contacts">
          <a className="guide-call" href="tel:+918838463776">
            <Phone size={18} aria-hidden="true" />
            <span>88384 63776</span>
          </a>
          <a className="guide-call" href="tel:+917027964880">
            <Phone size={18} aria-hidden="true" />
            <span>70279 64880</span>
          </a>
        </div>
      </section>

      <div className="guide-actions">
        <button className="s-button" onClick={onHowToRegister}>
          How to register <ArrowRight size={18} aria-hidden="true" />
        </button>
        <button className="s-button s-button--secondary" onClick={onChooseRace}>
          View race options
        </button>
      </div>
    </main>
  );
}
