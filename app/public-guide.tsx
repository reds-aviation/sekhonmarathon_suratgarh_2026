import { useEffect, useRef, useState, type MouseEvent } from 'react';
import {
  ArrowRight,
  BookOpen,
  ChevronRight,
  CupSoda,
  Flag,
  Home as HomeIcon,
  Medal,
  ShieldCheck,
  Shirt,
  Award,
  UserRound,
} from 'lucide-react';
import { EventGallery } from '@/components/event-gallery';
import { EventGuide } from '@/components/event-guide';
import { EventTribute } from '@/components/event-tribute';
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
  guide: 'Event guide',
  tribute: 'Why we run',
  gallery: 'Campaign & memories',
};

function secureAppHref(hash = '') {
  const url = new URL(import.meta.env.VITE_PUBLIC_APP_URL);
  url.hash = hash;
  return url.href;
}

export function PublicGuide() {
  const initial = parseSiteLocation(window.location.hash, window.location.search);
  const [page, setPage] = useState<SitePage>(initial.page || 'home');
  const [expandedRace, setExpandedRace] = useState<string | null>(
    initial.anchor?.startsWith('race-') ? initial.anchor.slice(5) : null,
  );
  const focusNext = useRef(Boolean(initial.anchor));

  function applyLocation() {
    const next = parseSiteLocation(window.location.hash, window.location.search);
    const nextPage = next.page || 'home';
    setPage(nextPage);
    setExpandedRace(next.anchor?.startsWith('race-') ? next.anchor.slice(5) : null);
    focusNext.current = true;
  }

  useEffect(() => {
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
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
      focusNext.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [page]);

  function go(hash: string, replace = false) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = hash;
    if (url.href !== window.location.href)
      window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    applyLocation();
    window.scrollTo({ top: 0, behavior: 'instant' });
  }

  function navigate(next: SitePage) {
    go(hashForPage(next));
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
          {(['home', 'races', 'guide', 'tribute'] as SitePage[]).map((view) => (
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
                  : view === 'guide'
                    ? 'Event guide'
                    : 'Why we run'}
            </a>
          ))}
          <a href={secureAppHref('#participant')}>
            <UserRound size={17} /> My entry
          </a>
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
              <p className="app-kicker">Desert Braves</p>
              <h1 id="home-title" tabIndex={-1}>
                <span>Air Force Station</span>
                Suratgarh
              </h1>
              <p className="app-tagline">The Land of Sun and Sand</p>
            </div>
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
                Entries close 27 September. Payment details will be published before registration opens.
              </p>
            </section>
            <section className="app-home-links" aria-label="Before your run">
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
            <p className="app-status" aria-live="polite"><span />Registration is currently closed</p>
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
                  <a className="app-primary" href={secureAppHref('#races')}>
                    Register in secure app <ArrowRight size={18} />
                  </a>
                </div>
              </details>
            ))}
          </div>
          <p className="app-small-note">Confirmed fees are shown. No payment is accepted in this public guide.</p>
          <section className="app-race-kit">
            <h2>Planned for every runner</h2>
            <div>
              <span><Shirt size={20} /> Event T-shirt</span>
              <span><Medal size={20} /> Medal</span>
              <span><Award size={20} /> Digital certificate</span>
              <span><CupSoda size={20} /> Refreshments</span>
            </div>
            <a href="#guide" onClick={(event) => follow(event, 'guide')}>
              Collection &amp; contact details <ArrowRight size={15} />
            </a>
          </section>
          <aside className="app-race-help">
            <ShieldCheck size={19} />
            <p>Airwarriors and families only. Sign in with your email and station invitation code when registration opens.</p>
          </aside>
        </main>
      )}
      {page === 'guide' && <EventGuide onChooseRace={() => navigate('races')} />}
      {page === 'tribute' && <EventTribute onChooseRace={() => navigate('races')} onOpenGallery={() => navigate('gallery')} />}
      {page === 'gallery' && <EventGallery onChooseRace={() => navigate('races')} />}

      <footer className="app-footer">
        <span>© 2026 Desert Braves · Suratgarh</span>
        <details className="app-more">
          <summary>More information</summary>
          <div>
            <a href={secureAppHref('#participant')}>My entry</a>
            <a href={secureAppHref('#verify')}>Verify a certificate</a>
            <a href={secureAppHref('#organiser')}>Organiser access</a>
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
        <a href="#guide" aria-current={page === 'guide' ? 'page' : undefined} onClick={(event) => follow(event, 'guide')}>
          <BookOpen size={21} /><span>Event guide</span>
        </a>
        <a href={secureAppHref('#participant')}><UserRound size={21} /><span>My entry</span></a>
      </nav>
    </div>
  );
}
