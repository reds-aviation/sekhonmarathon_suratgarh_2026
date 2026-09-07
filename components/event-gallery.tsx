'use client';

import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';

const assetBase = import.meta.env.BASE_URL.replace(/\/$/, '');
const archiveBase = `${assetBase}/assets/archive-2025`;
const campaignBase = `${assetBase}/assets/campaign-2026`;

const campaignPosters = [
  {
    file: 'legacy-of-courage-poster',
    label: 'Legacy of Courage',
    aspectRatio: '16 / 9',
    caption: '2026 campaign artwork — Legacy of Courage.',
    alt: 'Sekhon Indian Air Force Marathon 2026 poster for Air Force Station Suratgarh, showing Flying Officer Nirmal Jit Singh Sekhon PVC, Indian Air Force aircraft, runners and the 4 October event date.',
  },
  {
    file: 'anniversary-poster',
    label: '94 years',
    aspectRatio: '16 / 9',
    caption: '2026 campaign artwork — commemorating 94 years of the Indian Air Force.',
    alt: 'Sekhon Indian Air Force Marathon 2026 anniversary poster for Air Force Station Suratgarh, showing Flying Officer Nirmal Jit Singh Sekhon PVC, Indian Air Force aircraft, runners and the 4 October event date.',
  },
  {
    file: 'finish-line-poster',
    label: 'Finish line',
    aspectRatio: '16 / 9',
    caption: '2026 campaign artwork — a finish-line moment at Air Force Station Suratgarh.',
    alt: 'Sekhon Indian Air Force Marathon 2026 finish-line poster for Air Force Station Suratgarh, showing runners crossing a banner with Indian Air Force aircraft above.',
  },
  {
    file: 'run-soar-inspire-poster',
    label: 'Run · Soar · Inspire',
    aspectRatio: '1491 / 1055',
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
  const poster = campaignPosters[selectedPoster];
  const photo = photos[selected];

  function movePhoto(direction: number) {
    setSelected(
      (current) => (current + direction + photos.length) % photos.length,
    );
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
              src={`${campaignBase}/${poster.file}.png`}
              alt={poster.alt}
              width="1672"
              height="941"
              decoding="async"
            />
          </div>
          <figcaption>{poster.caption}</figcaption>
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
        <div className="gallery-poster-suite" aria-labelledby="poster-suite-title">
          <div>
            <p id="poster-suite-title">Three poster views</p>
            <span>One tribute, one station, one running community.</span>
          </div>
          <div className="gallery-poster-suite-grid">
            {[
              {
                label: 'Courage, service and sacrifice',
                position: 'left center',
              },
              { label: 'Run, soar, inspire', position: 'center center' },
              { label: '94 years together', position: 'right center' },
            ].map((item) => (
              <div
                className="gallery-poster-suite-card"
                key={item.label}
                role="img"
                aria-label={`${item.label} campaign poster`}
                style={{
                  backgroundImage: `url(${campaignBase}/poster-series.png)`,
                  backgroundPosition: item.position,
                }}
              />
            ))}
          </div>
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
    </main>
  );
}
