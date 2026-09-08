'use client';

import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Expand, X } from 'lucide-react';

const assetBase = import.meta.env.BASE_URL.replace(/\/$/, '');
const archiveBase = `${assetBase}/assets/archive-2025`;
const campaignBase = `${assetBase}/assets/campaign-2026`;
const posterWidths = [640, 960, 1440] as const;

function posterSource(file: string, width: (typeof posterWidths)[number]) {
  return `${campaignBase}/${file}-${width}.webp`;
}

function posterSrcSet(file: string) {
  return posterWidths
    .map((width) => `${posterSource(file, width)} ${width}w`)
    .join(', ');
}

const campaignPosters = [
  {
    file: 'legacy-of-courage-poster',
    label: 'Legacy of Courage',
    aspectRatio: '1672 / 941',
    width: 1672,
    height: 941,
    caption: '2026 campaign artwork — Legacy of Courage.',
    alt: 'Sekhon Indian Air Force Marathon 2026 poster for Air Force Station Suratgarh, showing Flying Officer Nirmal Jit Singh Sekhon PVC, Indian Air Force aircraft, runners and the 4 October event date.',
  },
  {
    file: 'anniversary-poster',
    label: '94 years',
    aspectRatio: '1672 / 941',
    width: 1672,
    height: 941,
    caption: '2026 campaign artwork — commemorating 94 years of the Indian Air Force.',
    alt: 'Sekhon Indian Air Force Marathon 2026 anniversary poster for Air Force Station Suratgarh, showing Flying Officer Nirmal Jit Singh Sekhon PVC, Indian Air Force aircraft, runners and the 4 October event date.',
  },
  {
    file: 'finish-line-poster',
    label: 'Finish line',
    aspectRatio: '1672 / 941',
    width: 1672,
    height: 941,
    caption: '2026 campaign artwork — a finish-line moment at Air Force Station Suratgarh.',
    alt: 'Sekhon Indian Air Force Marathon 2026 finish-line poster for Air Force Station Suratgarh, showing runners crossing a banner with Indian Air Force aircraft above.',
  },
  {
    file: 'run-soar-inspire-poster',
    label: 'Run · Soar · Inspire',
    aspectRatio: '1491 / 1055',
    width: 1491,
    height: 1055,
    caption: '2026 campaign artwork — Run, Soar, Inspire.',
    alt: 'Sekhon Indian Air Force Marathon 2026 poster for Air Force Station Suratgarh, showing runners, Indian Air Force aircraft and the Run, Soar, Inspire message.',
  },
];

const photos = [
  {
    file: '04_runners_at_start_line',
    caption: 'Together at the start',
    alt: 'Runners gather beneath the blue start arch at the 2025 Suratgarh marathon.',
  },
  {
    file: '06_pre_race_warmup',
    caption: 'Warming up together',
    alt: 'Participants stretch with their arms overhead near the finish arch in 2025.',
  },
  {
    file: '07_finish_area_group_photo',
    caption: 'At the finish area',
    alt: 'A group poses beneath the finish arch beside Desert Braves displays in 2025.',
  },
  {
    file: '01_registration_and_tshirt_distribution',
    caption: 'T-shirt distribution',
    alt: 'Event T-shirts stacked on tables beside the Suratgarh marathon sign in 2025.',
  },
  {
    file: '02_runner_kit_distribution',
    caption: 'Collecting the runner kit',
    alt: 'Participants gather around a T-shirt collection table beneath trees in 2025.',
  },
  {
    file: '03_start_finish_event_setup',
    caption: 'Preparing the start area',
    alt: 'Blue start arch beside the stage and Desert Braves event displays in 2025.',
  },
];

export function EventGallery({ onChooseRace }: { onChooseRace: () => void }) {
  const [selectedPoster, setSelectedPoster] = useState(0);
  const [selected, setSelected] = useState(0);
  const [isPosterViewerOpen, setPosterViewerOpen] = useState(false);
  const posterDialogRef = useRef<HTMLDialogElement>(null);
  const viewLargerRef = useRef<HTMLButtonElement>(null);
  const poster = campaignPosters[selectedPoster];
  const photo = photos[selected];

  useEffect(() => {
    const dialog = posterDialogRef.current;
    if (!dialog) return;

    if (isPosterViewerOpen) {
      if (!dialog.open) dialog.showModal();
      return;
    }

    if (dialog.open) dialog.close();
  }, [isPosterViewerOpen]);

  useEffect(() => {
    if (!isPosterViewerOpen) return;

    function handleKeydown(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      setSelectedPoster((current) =>
        (current + (event.key === 'ArrowRight' ? 1 : -1) + campaignPosters.length) %
        campaignPosters.length,
      );
    }

    window.addEventListener('keydown', handleKeydown);
    return () => window.removeEventListener('keydown', handleKeydown);
  }, [isPosterViewerOpen]);

  function movePhoto(direction: number) {
    setSelected(
      (current) => (current + direction + photos.length) % photos.length,
    );
  }

  function movePoster(direction: number) {
    setSelectedPoster(
      (current) => (current + direction + campaignPosters.length) % campaignPosters.length,
    );
  }

  function restorePosterFocus() {
    setPosterViewerOpen(false);
    requestAnimationFrame(() => viewLargerRef.current?.focus());
  }

  return (
    <main id="main" className="app-view event-gallery" tabIndex={-1}>
      <header className="gallery-header">
        <h1 tabIndex={-1}>Campaign &amp; memories</h1>
        <p>2026 campaign artwork, followed by last year’s Suratgarh event.</p>
      </header>

      <section className="gallery-campaign" aria-labelledby="campaign-title">
        <div className="gallery-section-heading">
          <p>2026 campaign artwork</p>
          <h2 id="campaign-title">Legacy of Courage.</h2>
        </div>
        <figure className="gallery-selected-poster">
          <div
            className="gallery-poster-frame"
            style={{ aspectRatio: poster.aspectRatio }}
          >
            <img
              key={poster.file}
              src={posterSource(poster.file, 1440)}
              srcSet={posterSrcSet(poster.file)}
              sizes="(max-width: 700px) calc(100vw - 64px), min(100vw - 104px, 1100px)"
              alt={poster.alt}
              width={poster.width}
              height={poster.height}
              decoding="async"
            />
          </div>
          <figcaption>{poster.caption}</figcaption>
          <button
            className="gallery-view-poster"
            type="button"
            ref={viewLargerRef}
            onClick={() => setPosterViewerOpen(true)}
          >
            <Expand size={17} aria-hidden="true" />
            View larger
          </button>
        </figure>
        <div className="gallery-poster-switcher" role="group" aria-label="Choose event artwork">
          {campaignPosters.map((item, index) => (
            <button
              type="button"
              key={item.file}
              onClick={() => setSelectedPoster(index)}
              aria-pressed={selectedPoster === index}
            >
              {item.label}
            </button>
          ))}
        </div>
      </section>

      <section className="gallery-archive" aria-labelledby="archive-title">
        <div className="gallery-section-heading">
          <p>2025 archive</p>
          <h2 id="archive-title">Last year at Suratgarh.</h2>
        </div>
        <p className="gallery-archive-note">
          Dates and notices shown in these photos belong to last year.
        </p>

        <div className="gallery-photos" aria-label="Photos from the 2025 event">
          <figure className="gallery-selected-photo">
            <div className="gallery-photo-frame">
              <img
                key={photo.file}
                src={`${archiveBase}/${photo.file}.webp`}
                alt={photo.alt}
                width="1536"
                height="1152"
                loading="lazy"
                decoding="async"
              />
            </div>
            <figcaption>{photo.caption}</figcaption>
          </figure>

          <div className="gallery-controls">
            <button
              type="button"
              onClick={() => movePhoto(-1)}
              aria-label="Previous photo"
            >
              <ArrowLeft size={17} aria-hidden="true" />
              Previous
            </button>
            <span
              className="gallery-count"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <span aria-hidden="true">
                {selected + 1} / {photos.length}
              </span>
              <span className="gallery-screen-reader">
                Photo {selected + 1} of {photos.length}: {photo.caption}
              </span>
            </span>
            <button
              type="button"
              onClick={() => movePhoto(1)}
              aria-label="Next photo"
            >
              Next
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>

          <div
            className="gallery-thumbnails"
            role="group"
            aria-label="Choose a photo"
          >
            {photos.map((item, index) => (
              <button
                type="button"
                key={item.file}
                onClick={() => setSelected(index)}
                aria-label={`Photo ${index + 1} of ${photos.length}: ${item.caption}`}
                aria-current={selected === index ? 'true' : undefined}
              >
                <img
                  src={`${archiveBase}/${item.file}-thumb.webp`}
                  alt=""
                  width="240"
                  height="180"
                  loading="lazy"
                  decoding="async"
                />
              </button>
            ))}
          </div>
        </div>
      </section>

      <div className="gallery-actions">
        <button type="button" onClick={onChooseRace}>
          Choose a race <ArrowRight size={18} aria-hidden="true" />
        </button>
      </div>

      <dialog
        className="gallery-poster-dialog"
        ref={posterDialogRef}
        aria-labelledby="gallery-poster-dialog-title"
        onClose={restorePosterFocus}
        onClick={(event) => {
          if (event.target === event.currentTarget) posterDialogRef.current?.close();
        }}
      >
        <div className="gallery-poster-dialog-shell">
          <div className="gallery-poster-dialog-header">
            <div>
              <p>2026 campaign artwork</p>
              <h2 id="gallery-poster-dialog-title">{poster.label}</h2>
            </div>
            <button
              type="button"
              className="gallery-poster-dialog-close"
              onClick={() => posterDialogRef.current?.close()}
              aria-label="Close larger poster view"
            >
              <X size={21} aria-hidden="true" />
              <span>Close</span>
            </button>
          </div>
          <img
            src={posterSource(poster.file, 1440)}
            srcSet={posterSrcSet(poster.file)}
            sizes="min(92vw, 1440px)"
            alt={poster.alt}
            width={poster.width}
            height={poster.height}
            decoding="async"
          />
          <div className="gallery-poster-dialog-controls" aria-label="Browse campaign artwork">
            <button type="button" onClick={() => movePoster(-1)}>
              <ArrowLeft size={17} aria-hidden="true" />
              Previous
            </button>
            <span aria-live="polite" aria-atomic="true">
              {selectedPoster + 1} of {campaignPosters.length}: {poster.label}
            </span>
            <button type="button" onClick={() => movePoster(1)}>
              Next
              <ArrowRight size={17} aria-hidden="true" />
            </button>
          </div>
          <p className="gallery-poster-dialog-hint">Use the left and right arrow keys to browse. Press Escape to close.</p>
        </div>
      </dialog>
    </main>
  );
}
