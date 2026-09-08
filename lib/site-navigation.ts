export type SitePage =
  | 'home'
  | 'races'
  | 'register'
  | 'guide'
  | 'tribute'
  | 'gallery';
export type PortalView = 'participant' | 'organiser' | 'verify';

export type SiteLocation =
  | { page: SitePage; portal: null; anchor?: string }
  | { page: null; portal: PortalView; anchor?: never };

const pageHashes: Record<SitePage, string> = {
  home: '#home',
  races: '#races',
  register: '#register',
  guide: '#guide',
  tribute: '#tribute',
  gallery: '#gallery',
};

const portalHashes: Record<PortalView, string> = {
  participant: '#race-desk',
  organiser: '#organiser',
  verify: '#verify-certificate',
};

const legacyPages: Record<string, SitePage> = {
  main: 'home',
  legacy: 'tribute',
  running: 'tribute',
  event: 'tribute',
  'race-day': 'guide',
  'how-to-register': 'register',
  faqs: 'guide',
  contact: 'guide',
  'guide-kit': 'guide',
  routes: 'guide',
  'race-5': 'races',
  'race-10': 'races',
  'race-21': 'races',
};

/** Stable, path-independent fragments for GitHub Pages and local previews. */
export function hashForPage(page: SitePage): string {
  return pageHashes[page];
}

export function hashForPortal(portal: PortalView): string {
  return portalHashes[portal];
}

/**
 * Parse location strings without reading the DOM or changing browser history.
 * A null page means a portal is open; callers can retain their last content page.
 * Legacy anchors omit '#', ready for getElementById after that page has rendered.
 */
export function parseSiteLocation(hash = '', search = ''): SiteLocation {
  if (new URLSearchParams(search).has('certificate')) {
    return { page: null, portal: 'verify' };
  }

  let fragment = hash.replace(/^#/, '');
  try {
    fragment = decodeURIComponent(fragment);
  } catch {
    return { page: 'home', portal: null };
  }

  for (const portal of Object.keys(portalHashes) as PortalView[]) {
    if (`#${fragment}` === portalHashes[portal]) {
      return { page: null, portal };
    }
  }
  if (Object.hasOwn(pageHashes, fragment)) {
    return { page: fragment as SitePage, portal: null };
  }
  if (Object.hasOwn(legacyPages, fragment)) {
    return {
      page: legacyPages[fragment],
      portal: null,
      anchor: fragment,
    };
  }
  return { page: 'home', portal: null };
}
