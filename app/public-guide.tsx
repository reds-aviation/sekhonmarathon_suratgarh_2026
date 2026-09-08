import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CupSoda,
  Flag,
  Home as HomeIcon,
  ListChecks,
  Medal,
  ShieldCheck,
  Shirt,
  Award,
} from 'lucide-react';
import { EventGallery } from '@/components/event-gallery';
import { EventGuide } from '@/components/event-guide';
import { EventTribute } from '@/components/event-tribute';
import { RegistrationGuide } from '@/components/registration-guide';
import {
  routeDistanceFromSearch,
  type RouteDistance,
} from '@/lib/route-selection';
import { RACES } from '@/lib/race-data';
import {
  hashForPage,
  parseSiteLocation,
  type SitePage,
} from '@/lib/site-navigation';

const base = import.meta.env.BASE_URL.replace(/\/$/u, '');

const titles: Record<SitePage, string> = {
  home: 'Sekhon IAF Marathon 2026',
  races: 'Choose your race',
  register: 'How to register',
  guide: 'Event guide',
  tribute: 'Why we run',
  gallery: 'Campaign & memories',
};

export function PublicGuide() {
  const initial = parseSiteLocation(window.location.hash, window.location.search);
  const [page, setPage] = useState<SitePage>(initial.page || 'home');
  const [anchor, setAnchor] = useState(initial.anchor);
  const [routeDistance, setRouteDistance] = useState<RouteDistance>(() =>
    routeDistanceFromSearch(window.location.search),
  );
  const [expandedRace, setExpandedRace] = useState<string | null>(
    initial.anchor?.startsWith('race-') ? initial.anchor.slice(5) : null,
  );
  const focusNext = useRef(Boolean(initial.anchor));

  function applyLocation() {
    const next = parseSiteLocation(window.location.hash, window.location.search);
    const nextPage = next.page || 'home';
    setPage(nextPage);
    setAnchor(next.anchor);
    setRouteDistance(routeDistanceFromSearch(window.location.search));
    setExpandedRace(next.anchor?.startsWith('race-') ? next.anchor.slice(5) : null);
    focusNext.current = true;
  }

  useEffect(() => {
    document.documentElement.dataset.eventApp = 'ready';
    window.addEventListener('popstate', applyLocation);
    window.addEventListener('hashchange', applyLocation);
    return () => {
      window.removeEventListener('popstate', applyLocation);
      window.removeEventListener('hashchange', applyLocation);
    };
  }, []);

  useEffect(() => {
    document.title = `${titles[page]} | Air Force Station Suratgarh`;
    if (!focusNext.current) return;
    const frame = requestAnimationFrame(() => {
      const target = anchor ? document.getElementById(anchor) : null;
      const disclosure = target?.closest('details');
      if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;

      const focusTarget = target?.querySelector<HTMLElement>(
        'summary, h2[tabindex], h3[tabindex], [tabindex]',
      );

      if (focusTarget) {
        focusTarget.focus({ preventScroll: true });
        focusTarget.scrollIntoView({ block: 'start', behavior: 'instant' });
      } else {
        window.scrollTo({ top: 0, behavior: 'instant' });
        document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
      }
      focusNext.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, anchor]);

  function go(hash: string, replace = false, search = '') {
    const url = new URL(window.location.href);
    url.search = search;
    url.hash = hash;
    if (url.href !== window.location.href)
      window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    applyLocation();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function navigate(next: SitePage) {
    go(hashForPage(next));
  }

  function selectGuideRoute(distance: RouteDistance) {
    const url = new URL(window.location.href);
    url.search = `?route=${distance}`;
    url.hash = hashForPage('guide');
    if (url.href !== window.location.href)
      window.history.replaceState(null, '', url);
    setRouteDistance(distance);
  }

  function viewRoute(
    event: MouseEvent<HTMLAnchorElement>,
    distance: RouteDistance,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    go(hashForPage('guide'), false, `?route=${distance}`);
  }

  function follow(
    event: MouseEvent<HTMLAnchorElement>,
    next: SitePage,
    hash?: string,
  ) {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    go(hash || hashForPage(next));
  }

  return (
    <div className={`marathon-app app-page-${page}`}>
      <a
        className="skip-link"
        href="#main"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main')?.focus();
        }}
      >
        Skip to content
      </a>
      <div className="app-access">
        <ShieldCheck size={13} />
        <span>For airwarriors &amp; families</span>
      </div>
      <header className="app-header">
        <a
          className="app-wordmark"
          href="#home"
          onClick={(event) => follow(event, 'home')}
          aria-label="Air Force Station Suratgarh — home"
        >
          <img
            src={`${base}/assets/sekhon-logo.webp`}
            alt="Sekhon Marathon"
            width="52"
            height="40"
          />
          <span>
            <small>AIR FORCE STATION</small>
            <b>SURATGARH</b>
          </span>
        </a>
        <nav className="app-desktop-nav" aria-label="Main navigation">
          {(['home', 'races', 'register', 'guide', 'tribute'] as SitePage[]).map((view) => (
            <a
              key={view}
              href={hashForPage(view)}
              aria-current={page === view ? 'page' : undefined}
              onClick={(event) => follow(event, view)}
            >
              {view === 'home'
                ? 'Home'
                : view === 'races'
                  ? 'Races'
                  : view === 'register'
                    ? 'How to register'
                  : view === 'guide'
                    ? 'Event guide'
                    : 'Why we run'}
            </a>
          ))}
        </nav>
        <a
          className="app-mobile-tribute"
          href="#tribute"
          onClick={(event) => follow(event, 'tribute')}
          aria-label="Why we run — the Sekhon tribute"
          aria-current={page === 'tribute' ? 'page' : undefined}
        >
          <Medal size={20} />
          <span>Why we run</span>
        </a>
      </header>

      {page === 'home' && (
        <main id="main" className="app-home" tabIndex={-1}>
          <section className="app-hero app-hero--campaign" aria-labelledby="home-title">
            <figure className="app-painting app-painting--campaign">
              <picture>
                <source
                  media="(max-width: 700px)"
                  srcSet={`${base}/assets/suratgarh-home-hero-mobile-v3.jpg`}
                />
                <img
                  src={`${base}/assets/suratgarh-home-hero-desktop-v3.jpg`}
                  width="1774"
                  height="887"
                  fetchPriority="high"
                  alt="Text-free campaign illustration of Flying Officer Nirmal Jit Singh Sekhon, runners on a landscaped station road at sunrise, and Indian Air Force aircraft above Air Force Station Suratgarh"
                />
              </picture>
            </figure>
            <div className="app-hero-copy app-hero-copy--campaign">
              <p className="app-kicker">Desert Braves · Air Force Station Suratgarh</p>
              <h1 id="home-title" tabIndex={-1}>
                Sekhon Indian Air Force
                <span>Marathon 2026</span>
              </h1>
              <p className="app-hero-station">Air Force Station Suratgarh</p>
              <p className="app-tagline">Run · Soar · Inspire</p>
              <p className="app-hero-details">
                <span>Sunday, 4 October 2026</span>
                <span>5 KM · 10 KM · 21 KM</span>
              </p>
              <a
                className="app-hero-action"
                href="#register"
                onClick={(event) => follow(event, 'register')}
              >
                How to register <ArrowRight size={17} aria-hidden="true" />
              </a>
              <p className="app-hero-deadline">Registration closes 27 September</p>
            </div>
          </section>
          <section className="app-home-facts" aria-label="Event at a glance">
            <div><small>Race day</small><strong>4 October 2026</strong></div>
            <div><small>Three distances</small><strong>5 KM · 10 KM · 21 KM</strong></div>
            <div><small>Registration</small><strong>Official AFNET portal</strong></div>
          </section>
          <div className="app-home-grid">
            <section aria-labelledby="home-races-title">
              <div className="app-section-title">
                <h2 id="home-races-title">Find your distance.</h2>
                <span>Confirmed fees</span>
              </div>
              <div className="app-distance-list">
                {RACES.map((race) => (
                  <a
                    key={race.distance}
                    href={`#race-${race.distance}`}
                    onClick={(event) => follow(event, 'races', `#race-${race.distance}`)}
                    aria-label={`${race.distance} KM ${race.name}, confirmed fee ₹${race.fee}, view details`}
                  >
                    <strong>{race.distance}<small>KM</small></strong>
                    <span><b>{race.name}</b></span>
                    <em>₹{race.fee}</em>
                    <ChevronRight size={18} />
                  </a>
                ))}
              </div>
              <p className="app-small-note">
                Register on AFNET by 27 September. Pay at Sports Section during normal working hours through the SI POS machine.
              </p>
            </section>
            <section className="app-home-links" aria-label="Before your run">
              <a className="app-guide-shortcut app-register-shortcut" href="#register" onClick={(event) => follow(event, 'register')}>
                <ListChecks size={23} />
                <span><b>How to register</b><small>AFNET steps · payment guidance</small></span>
                <ChevronRight size={18} />
              </a>
              <a className="app-guide-shortcut" href="#guide" onClick={(event) => follow(event, 'guide')}>
                <BookOpen size={23} />
                <span><b>Your event guide</b><small>T-shirt collection · 3 October</small></span>
                <ChevronRight size={18} />
              </a>
              <a className="app-tribute-teaser" href="#tribute" onClick={(event) => follow(event, 'tribute')}>
                <img
                  src={`${base}/assets/nirmal-jit-singh-sekhon-portrait.webp`}
                  alt="Flying Officer Nirmal Jit Singh Sekhon PVC"
                  width="72"
                  height="54"
                  loading="lazy"
                />
                <span><b>In honour of Sekhon PVC.</b><small>Discover why we run <ArrowRight size={15} /></small></span>
              </a>
              <a
                className="app-tribute-teaser"
                href="#gallery"
                onClick={(event) => follow(event, 'gallery')}
                aria-label="View 2026 campaign artwork and 2025 event memories"
              >
                <img src={`${base}/assets/sekhon-logo.webp`} alt="" width="72" height="54" loading="lazy" />
                <span><b>2026 campaign artwork</b><small>Posters and 2025 memories <ArrowRight size={15} /></small></span>
              </a>
            </section>
          </div>
        </main>
      )}

      {page === 'races' && (
        <main id="main" className="app-view app-races-view" tabIndex={-1}>
          <header className="app-view-header">
            <p className="app-kicker">Your start line</p>
            <h1 tabIndex={-1}>Choose your distance.</h1>
            <p>Tap a race for details.</p>
            <p className="app-status" aria-live="polite"><span />Official registration is completed on AFNET</p>
          </header>
          <div className="app-race-choices">
            {RACES.map((race) => (
              <details className="app-race-choice" id={`race-${race.distance}`} key={race.distance} open={expandedRace === race.distance}>
                <summary
                  onClick={(event) => {
                    event.preventDefault();
                    setExpandedRace((current) => current === race.distance ? null : race.distance);
                  }}
                >
                  <strong>{race.distance}<small>KM</small></strong>
                  <span><b>{race.name}</b><small>{race.detail}</small></span>
                  <span className="app-race-price"><b>₹{race.fee}</b><small>confirmed</small></span>
                  <ChevronRight size={19} />
                </summary>
                <div className="app-race-detail">
                  <p>{race.description}</p>
                  <div className="app-race-actions">
                    <a
                      className="app-route-link"
                      href={`?route=${race.distance}#guide`}
                      onClick={(event) =>
                        viewRoute(event, race.distance as RouteDistance)
                      }
                    >
                      View this route <ArrowRight size={18} />
                    </a>
                    <a className="app-primary" href="#register" onClick={(event) => follow(event, 'register')}>
                      How to register <ArrowRight size={18} />
                    </a>
                  </div>
                </div>
              </details>
            ))}
          </div>
          <p className="app-small-note">Fees are ₹200 for 5 KM and ₹250 for 10 KM or 21 KM. Payment is made at Sports Section during normal working hours through the SI POS machine.</p>
          <section className="app-race-kit">
            <h2>For every registered participant</h2>
            <div>
              <span><Shirt size={20} /> Event T-shirt</span>
              <span><Medal size={20} /> Medal</span>
              <span><Award size={20} /> Digital certificate</span>
              <span><CupSoda size={20} /> Refreshments</span>
            </div>
            <p className="app-small-note">Every registered participant will receive the event T-shirt and medal.</p>
            <a href="#guide" onClick={(event) => follow(event, 'guide')}>
              Route, collection &amp; race-day details <ArrowRight size={15} />
            </a>
          </section>
          <aside className="app-race-help">
            <ShieldCheck size={19} />
            <p>Airwarriors and families only. Complete the official form from an AFNET-connected system by 27 September 2026.</p>
          </aside>
        </main>
      )}
      {page === 'register' && (
        <RegistrationGuide
          onChooseRace={() => navigate('races')}
          onOpenEventGuide={() => navigate('guide')}
        />
      )}
      {page === 'guide' && (
        <EventGuide
          onChooseRace={() => navigate('races')}
          onHowToRegister={() => navigate('register')}
          selectedRoute={routeDistance}
          onSelectRoute={selectGuideRoute}
        />
      )}
      {page === 'tribute' && <EventTribute onChooseRace={() => navigate('races')} onOpenGallery={() => navigate('gallery')} />}
      {page === 'gallery' && <EventGallery onChooseRace={() => navigate('races')} />}

      <footer className="app-footer">
        <div className="app-footer-credit">
          <span>© 2026 Desert Braves · Air Force Station Suratgarh</span>
          <strong>Developed by Flt Lt Balaram Reddy, OIC Sports and Adv</strong>
        </div>
        <details className="app-more">
          <summary>More information</summary>
          <div>
            <button onClick={() => navigate('register')}>How to register</button>
            <button onClick={() => navigate('guide')}>Event guide</button>
            <button onClick={() => navigate('gallery')}>Campaign &amp; memories</button>
          </div>
        </details>
      </footer>
      <nav className="app-bottom-nav" aria-label="Main navigation">
        <a href="#home" aria-current={page === 'home' ? 'page' : undefined} onClick={(event) => follow(event, 'home')}>
          <HomeIcon size={21} /><span>Home</span>
        </a>
        <a href="#races" aria-current={page === 'races' ? 'page' : undefined} onClick={(event) => follow(event, 'races')}>
          <Flag size={21} /><span>Races</span>
        </a>
        <a href="#register" aria-current={page === 'register' ? 'page' : undefined} onClick={(event) => follow(event, 'register')}>
          <ListChecks size={21} /><span>How to register</span>
        </a>
        <a href="#guide" aria-current={page === 'guide' ? 'page' : undefined} onClick={(event) => follow(event, 'guide')}>
          <BookOpen size={21} /><span>Event guide</span>
        </a>
      </nav>
    </div>
  );
}
