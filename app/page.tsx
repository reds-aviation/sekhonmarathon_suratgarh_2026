'use client';
import {
  lazy,
  Suspense,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  ArrowRight,
  ShieldCheck,
  Medal,
  Shirt,
  Award,
  CupSoda,
  UserRound,
  Home as HomeIcon,
  Flag,
  BookOpen,
  ChevronRight,
  Download,
} from 'lucide-react';
import { Registration } from '@/components/registration';
import { PolicyDialog } from '@/components/policies';
import { PortalRecovery } from '@/components/portal-recovery';
import { EventGuide } from '@/components/event-guide';
import { EventTribute } from '@/components/event-tribute';
import { EventGallery } from '@/components/event-gallery';
import { useEventAvailability } from '@/lib/event-availability';
import { RACES } from '@/lib/race-data';
import {
  parseSiteLocation,
  hashForPage,
  hashForPortal,
  type SitePage,
  type PortalView,
} from '@/lib/site-navigation';

const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
const isPublicGuide = import.meta.env.VITE_BUILD_TARGET === 'pages';
const EventPortal = isPublicGuide
  ? null
  : lazy(() =>
      import('@/components/event-portal').then((module) => ({
        default: module.EventPortal,
      })),
    );
const OrganiserPaymentReviewQueue = isPublicGuide
  ? null
  : lazy(() =>
      import('@/components/organiser/payment-review-queue').then((module) => ({
        default: module.OrganiserPaymentReviewQueue,
      })),
    );
const OrganiserTshirtCollectionDesk = isPublicGuide
  ? null
  : lazy(() =>
      import('@/components/organiser/tshirt-collection-desk').then((module) => ({
        default: module.OrganiserTshirtCollectionDesk,
      })),
    );
const OrganiserRaceCompletionDesk = isPublicGuide
  ? null
  : lazy(() =>
      import('@/components/organiser/race-completion-desk').then((module) => ({
        default: module.OrganiserRaceCompletionDesk,
      })),
    );
const OrganiserRouteTimelineDesk = isPublicGuide
  ? null
  : lazy(() =>
      import('@/components/organiser/route-timeline-desk').then((module) => ({
        default: module.OrganiserRouteTimelineDesk,
      })),
    );
const titles: Record<SitePage, string> = {
  home: 'Sekhon IAF Marathon 2026',
  races: 'Choose your race',
  guide: 'Event guide',
  tribute: 'Why we run',
  gallery: 'Campaign & memories',
};

export default function Home() {
  const initial = parseSiteLocation(
    window.location.hash,
    window.location.search,
  );
  const [page, setPage] = useState<SitePage>(initial.page || 'home');
  const [portal, setPortal] = useState<PortalView | null>(initial.portal);
  const [anchor, setAnchor] = useState(initial.anchor);
  const [selected, setSelected] = useState<string | null>(null);
  const [policy, setPolicy] = useState<string | null>(null);
  const [organiserDesk, setOrganiserDesk] = useState<
    'payments' | 'tshirts' | 'completion' | 'route'
  >('payments');
  const [expandedRace, setExpandedRace] = useState<string | null>(
    initial.anchor?.startsWith('race-') ? initial.anchor.slice(5) : null,
  );
  const [lastPage, setLastPage] = useState<SitePage>(initial.page || 'home');
  const focusNext = useRef(Boolean(initial.anchor));
  const { availability, config, confirmedFees } = useEventAvailability();
  const canRegister = !isPublicGuide && availability === 'open';
  const liveFeesRequired =
    !isPublicGuide &&
    (!!config?.payment_configured || availability === 'unavailable');
  const feeStatus = isPublicGuide
    ? 'Confirmed'
    : liveFeesRequired
      ? confirmedFees
        ? 'Confirmed'
        : 'Unavailable'
      : 'Confirmed';
  const feeLabel = (race: (typeof RACES)[number]) => {
    const amount = isPublicGuide
      ? race.fee
      : liveFeesRequired
        ? confirmedFees?.[race.distance as keyof typeof confirmedFees]
        : race.fee;
    return amount === undefined
      ? 'Unavailable'
      : `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  };
  const status = isPublicGuide
    ? 'Registration is currently closed'
    : {
        loading: 'Checking registration',
        upcoming: 'Registration opens soon',
        open: 'Registration open',
        closed: 'Registration closed',
        unavailable: 'Registration temporarily unavailable',
      }[availability];

  function secureAppHref(hash = '', search = '') {
    const url = new URL(import.meta.env.VITE_PUBLIC_APP_URL);
    url.search = search;
    url.hash = hash;
    return url.href;
  }

  function applyLocation() {
    const next = parseSiteLocation(
      window.location.hash,
      window.location.search,
    );
    if (next.page) {
      setPage(next.page);
      setLastPage(next.page);
    }
    setPortal(next.portal);
    setAnchor(next.anchor);
    setExpandedRace(
      next.anchor?.startsWith('race-') ? next.anchor.slice(5) : null,
    );
    setSelected(null);
    setPolicy(null);
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
    document.title = `${portal ? (portal === 'participant' ? 'My entry' : portal === 'organiser' ? 'Organiser console' : 'Certificate verification') : titles[page]} | Air Force Station Suratgarh`;
    if (!focusNext.current) return;
    const frame = requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      if (!portal) {
        const section = anchor
          ? document
              .getElementById(anchor)
              ?.querySelector<HTMLElement>('summary, h2')
          : null;
        if (section) {
          section.focus({ preventScroll: true });
          section.scrollIntoView({ block: 'start', behavior: 'instant' });
        } else
          document
            .querySelector<HTMLElement>('main h1')
            ?.focus({ preventScroll: true });
      }
      focusNext.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [page, portal, anchor]);
  function go(hash: string, replace = false) {
    const url = new URL(window.location.href);
    url.searchParams.delete('certificate');
    url.hash = hash;
    if (url.href !== window.location.href)
      window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
    const next = parseSiteLocation(url.hash, url.search);
    const samePage =
      next.page === page && next.portal === portal && next.anchor === anchor;
    applyLocation();
    window.scrollTo({ top: 0, behavior: 'instant' });
    if (samePage && !portal) {
      requestAnimationFrame(() => {
        const section = anchor
          ? document
              .getElementById(anchor)
              ?.querySelector<HTMLElement>('summary, h2')
          : null;
        (section || document.querySelector<HTMLElement>('main h1'))?.focus({
          preventScroll: true,
        });
        section?.scrollIntoView({ block: 'start', behavior: 'instant' });
        focusNext.current = false;
      });
    }
  }
  function navigate(next: SitePage) {
    go(hashForPage(next));
  }
  function openPortal(view: PortalView = 'participant') {
    if (isPublicGuide) {
      window.location.assign(secureAppHref(hashForPortal(view)));
      return;
    }
    go(hashForPortal(view));
  }
  function closePortal() {
    go(hashForPage(lastPage), true);
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
  if (portal && isPublicGuide)
    return (
      <main className="portal-recovery">
        <p>AIR FORCE STATION SURATGARH</p>
        <h1>Continue in the secure app</h1>
        <p>
          Registration, organiser access and certificate checks are handled in
          the authenticated event app. The public guide remains available here.
        </p>
        <div>
          <a
            className="app-primary"
            href={secureAppHref(
              hashForPortal(portal),
              portal === 'verify' ? window.location.search : '',
            )}
          >
            Open secure app <ArrowRight size={18} />
          </a>
          <a href={hashForPage(lastPage)}>Return to event guide</a>
        </div>
      </main>
    );

  if (portal === 'organiser' && OrganiserPaymentReviewQueue)
    return (
      <PortalRecovery onClose={closePortal}>
        <Suspense
          fallback={
            <main className="portal-loading" aria-live="polite">
              Opening organiser payment review…
            </main>
          }
        >
          <main className="organiser-payment-portal" id="main">
            <div className="organiser-payment-portal__toolbar">
              <button onClick={closePortal} type="button">
                Return to event
              </button>
            </div>
            <div
              className="organiser-payment-portal__desk-tabs"
              aria-label="Organiser tools"
              role="tablist"
            >
              <button
                aria-controls="organiser-payment-desk"
                aria-selected={organiserDesk === 'payments'}
                onClick={() => setOrganiserDesk('payments')}
                role="tab"
                type="button"
              >
                Payment review
              </button>
              <button
                aria-controls="organiser-tshirt-desk"
                aria-selected={organiserDesk === 'tshirts'}
                onClick={() => setOrganiserDesk('tshirts')}
                role="tab"
                type="button"
              >
                T-shirt collection
              </button>
              <button
                aria-controls="organiser-completion-desk"
                aria-selected={organiserDesk === 'completion'}
                onClick={() => setOrganiserDesk('completion')}
                role="tab"
                type="button"
              >
                Completion desk
              </button>
              <button
                aria-controls="organiser-route-desk"
                aria-selected={organiserDesk === 'route'}
                onClick={() => setOrganiserDesk('route')}
                role="tab"
                type="button"
              >
                Route timeline
              </button>
            </div>
            {organiserDesk === 'payments' ? (
              <div id="organiser-payment-desk" role="tabpanel">
                <OrganiserPaymentReviewQueue />
              </div>
            ) : organiserDesk === 'tshirts' && OrganiserTshirtCollectionDesk ? (
              <div id="organiser-tshirt-desk" role="tabpanel">
                <OrganiserTshirtCollectionDesk />
              </div>
            ) : organiserDesk === 'completion' && OrganiserRaceCompletionDesk ? (
              <div id="organiser-completion-desk" role="tabpanel">
                <OrganiserRaceCompletionDesk />
              </div>
            ) : organiserDesk === 'route' && OrganiserRouteTimelineDesk ? (
              <div id="organiser-route-desk" role="tabpanel">
                <OrganiserRouteTimelineDesk />
              </div>
            ) : null}
          </main>
        </Suspense>
      </PortalRecovery>
    );

  if (portal && EventPortal)
    return (
      <PortalRecovery onClose={closePortal}>
        <Suspense
          fallback={
            <main className="portal-loading" aria-live="polite">
              Opening My entry…
            </main>
          }
        >
          <EventPortal
            initialView={portal}
            onViewChange={openPortal}
            onOpenOrganiser={() => openPortal('organiser')}
            onClose={closePortal}
          />
        </Suspense>
      </PortalRecovery>
    );

  return (
    <>
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
          <span>For airwarriors & families</span>
        </div>
        <header className="app-header">
          <a
            className="app-wordmark"
            href="#home"
            onClick={(event) => follow(event, 'home')}
            aria-label="Air Force Station Suratgarh — home"
          >
            {/* oxlint-disable-next-line next/no-img-element -- Vite serves this fixed-size, optimized local asset. */}
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
            {(['home', 'races', 'guide', 'tribute'] as SitePage[]).map(
              (view) => (
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
              ),
            )}
            <button onClick={() => openPortal()}>
              <UserRound size={17} /> My entry
            </button>
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
                  {/* oxlint-disable-next-line next/no-img-element -- Vite serves this locally generated hero artwork. */}
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
                  <span>{feeStatus} fees</span>
                </div>
                <div className="app-distance-list">
                  {RACES.map((race) => (
                    <a
                      key={race.distance}
                      href={`#race-${race.distance}`}
                      onClick={(event) =>
                        follow(event, 'races', `#race-${race.distance}`)
                      }
                      aria-label={`${race.distance} KM ${race.name}, ${feeStatus.toLowerCase()} fee ${feeLabel(race)}, view details`}
                    >
                      <strong>
                        {race.distance}
                        <small>KM</small>
                      </strong>
                      <span>
                        <b>{race.name}</b>
                      </span>
                      <em>{feeLabel(race)}</em>
                      <ChevronRight size={18} />
                    </a>
                  ))}
                </div>
                <p className="app-small-note">
                  Entries close 27 September.{' '}
                  {liveFeesRequired
                    ? confirmedFees
                      ? 'Fees shown are confirmed.'
                      : 'Fees are unavailable. Please try again later.'
                    : 'Payment details will be published before registration opens.'}
                </p>
              </section>
              <section className="app-home-links" aria-label="Before your run">
                <a
                  className="app-guide-shortcut"
                  href="#guide"
                  onClick={(event) => follow(event, 'guide')}
                >
                  <BookOpen size={23} />
                  <span>
                    <b>Your event guide</b>
                    <small>T-shirt collection · 3 October</small>
                  </span>
                  <ChevronRight size={18} />
                </a>
                <a
                  className="app-tribute-teaser"
                  href="#tribute"
                  onClick={(event) => follow(event, 'tribute')}
                >
                  {/* oxlint-disable-next-line next/no-img-element -- Vite serves this fixed-size, optimized local asset. */}
                  <img
                    src={`${base}/assets/nirmal-jit-singh-sekhon-portrait.webp`}
                    alt="Flying Officer Nirmal Jit Singh Sekhon PVC"
                    width="72"
                    height="54"
                    loading="lazy"
                  />
                  <span>
                    <b>In honour of Sekhon PVC.</b>
                    <small>
                      Discover why we run <ArrowRight size={15} />
                    </small>
                  </span>
                </a>
                <a
                  className="app-tribute-teaser"
                  href="#gallery"
                  onClick={(event) => follow(event, 'gallery')}
                  aria-label="View 2026 campaign artwork and 2025 event memories"
                >
                  {/* oxlint-disable-next-line next/no-img-element -- Vite serves this fixed-size, optimized local asset. */}
                  <img
                    src={`${base}/assets/sekhon-logo.webp`}
                    alt=""
                    width="72"
                    height="54"
                    loading="lazy"
                  />
                  <span>
                    <b>2026 campaign artwork</b>
                    <small>
                      Posters and 2025 memories <ArrowRight size={15} />
                    </small>
                  </span>
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
              <p className="app-status" aria-live="polite">
                <span />
                {status}
              </p>
            </header>
            <div className="app-race-choices">
              {RACES.map((race) => (
                <details
                  className="app-race-choice"
                  id={`race-${race.distance}`}
                  key={race.distance}
                  open={expandedRace === race.distance}
                >
                  <summary
                    onClick={(event) => {
                      event.preventDefault();
                      setExpandedRace((current) =>
                        current === race.distance ? null : race.distance,
                      );
                    }}
                  >
                    <strong>
                      {race.distance}
                      <small>KM</small>
                    </strong>
                    <span>
                      <b>{race.name}</b>
                      <small>{race.detail}</small>
                    </span>
                    <span className="app-race-price">
                      <b>{feeLabel(race)}</b>
                      <small>{feeStatus.toLowerCase()}</small>
                    </span>
                    <ChevronRight size={19} />
                  </summary>
                  <div className="app-race-detail">
                    <p>{race.description}</p>
                    {isPublicGuide ? (
                      <a className="app-primary" href={secureAppHref('#races')}>
                        Register in secure app <ArrowRight size={18} />
                      </a>
                    ) : (
                      <button
                        className="app-primary"
                        onClick={() => setSelected(race.distance)}
                      >
                        {canRegister ? 'Register for' : 'Preview'}{' '}
                        {race.distance} KM <ArrowRight size={18} />
                      </button>
                    )}
                  </div>
                </details>
              ))}
            </div>
            <p className="app-small-note">
              {liveFeesRequired
                ? confirmedFees
                  ? 'Fees shown are confirmed.'
                  : 'Fees are unavailable. Payments are not open.'
                : 'Fees are provisional. No payment is accepted in the preview.'}
            </p>
            <section className="app-race-kit">
              <h2>Planned for every runner</h2>
              <div>
                <span>
                  <Shirt size={20} /> Event T-shirt
                </span>
                <span>
                  <Medal size={20} /> Medal
                </span>
                <span>
                  <Award size={20} /> Digital certificate
                </span>
                <span>
                  <CupSoda size={20} /> Refreshments
                </span>
              </div>
              <a href="#guide" onClick={(event) => follow(event, 'guide')}>
                Collection & contact details <ArrowRight size={15} />
              </a>
            </section>
            <aside className="app-race-help">
              <ShieldCheck size={19} />
              <p>
                Airwarriors and families only. Sign in with your email and
                station invitation code when registration opens.
              </p>
            </aside>
          </main>
        )}
        {page === 'guide' && (
          <EventGuide
            key={anchor || 'guide'}
            onChooseRace={() => navigate('races')}
          />
        )}
        {page === 'tribute' && (
          <EventTribute
            onChooseRace={() => navigate('races')}
            onOpenGallery={() => navigate('gallery')}
          />
        )}
        {page === 'gallery' && (
          <EventGallery onChooseRace={() => navigate('races')} />
        )}

        <footer className="app-footer">
          <span>© 2026 Desert Braves · Suratgarh</span>
          <details className="app-more">
            <summary>More information</summary>
            <div>
              <button onClick={() => setPolicy('terms')}>
                Terms & conditions
              </button>
              <button onClick={() => setPolicy('privacy')}>Privacy</button>
              <button onClick={() => setPolicy('refund')}>Refund policy</button>
              <button onClick={() => navigate('gallery')}>Campaign &amp; memories</button>
              <button onClick={() => openPortal('verify')}>
                Verify a certificate
              </button>
              <button onClick={() => openPortal('organiser')}>
                Organiser access
              </button>
              <details className="app-install">
                <summary>
                  <Download size={16} /> Add to your phone
                </summary>
                <p>
                  Android: choose Install app or Add to Home screen in your
                  browser menu, when available.
                </p>
                <p>
                  iPhone: open in Safari, tap Share, then Add to Home Screen.
                  Registration and results need an internet connection.
                </p>
              </details>
            </div>
          </details>
        </footer>
        {!selected && !policy && (
          <nav className="app-bottom-nav" aria-label="Main navigation">
            <a
              href="#home"
              aria-current={page === 'home' ? 'page' : undefined}
              onClick={(event) => follow(event, 'home')}
            >
              <HomeIcon size={21} />
              <span>Home</span>
            </a>
            <a
              href="#races"
              aria-current={page === 'races' ? 'page' : undefined}
              onClick={(event) => follow(event, 'races')}
            >
              <Flag size={21} />
              <span>Races</span>
            </a>
            <a
              href="#guide"
              aria-current={page === 'guide' ? 'page' : undefined}
              onClick={(event) => follow(event, 'guide')}
            >
              <BookOpen size={21} />
              <span>Event guide</span>
            </a>
            <button onClick={() => openPortal()}>
              <UserRound size={21} />
              <span>My entry</span>
            </button>
          </nav>
        )}
      </div>
      {selected && (
        <Registration
          race={selected}
          onClose={() => setSelected(null)}
          onPolicy={setPolicy}
          onChooseRace={() => {
            setSelected(null);
            navigate('races');
          }}
        />
      )}
      {policy && (
        <PolicyDialog policy={policy} onClose={() => setPolicy(null)} />
      )}
    </>
  );
}
