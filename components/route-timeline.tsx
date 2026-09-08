'use client';

import { useState } from 'react';
import { Flag, Info, RotateCcw } from 'lucide-react';

type RouteDistance = '5' | '10' | '21';

const routes: Record<
  RouteDistance,
  { name: string; summary: string; steps: readonly string[] }
> = {
  '5': {
    name: '5 KM Fun Run',
    summary: 'A short out-and-back course with one marked turnaround.',
    steps: ['Start zone', 'Shared outbound course', '5 KM turnaround', 'Return leg', 'Finish zone'],
  },
  '10': {
    name: '10 KM Challenge Run',
    summary: 'Continue beyond the 5 KM turn to the second marked turnaround.',
    steps: ['Start zone', 'Shared outbound course', 'Extended course', '10 KM turnaround', 'Return to finish'],
  },
  '21': {
    name: '21 KM Half Marathon',
    summary: 'Follow the long-course extension to the final marked turnaround.',
    steps: ['Start zone', 'Shared outbound course', 'Long-course extension', '21 KM turnaround', 'Return to finish'],
  },
};

export function RouteTimeline() {
  const [distance, setDistance] = useState<RouteDistance>('5');
  const route = routes[distance];

  return (
    <section className="route-timeline" id="routes" aria-labelledby="route-title">
      <div className="route-heading">
        <p className="guide-kicker">Simple route sequence</p>
        <h2 id="route-title">See how each course progresses</h2>
        <p>Select a distance to view its out-and-back sequence.</p>
      </div>

      <fieldset className="route-tabs" aria-label="Choose a route distance">
        {(Object.keys(routes) as RouteDistance[]).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={distance === option}
            onClick={() => setDistance(option)}
          >
            {option} KM
          </button>
        ))}
      </fieldset>

      <div className="route-card" aria-live="polite">
        <div className="route-card-title">
          <span>{distance}<small>KM</small></span>
          <div>
            <h3>{route.name}</h3>
            <p>{route.summary}</p>
          </div>
        </div>
        <ol>
          {route.steps.map((step, index) => (
            <li key={step}>
              <span className="route-marker" aria-hidden="true">
                {index === 0 ? <Flag size={15} /> : index === route.steps.length - 1 ? <Flag size={15} /> : index + 1}
              </span>
              <strong>{step}</strong>
              {step.includes('turnaround') && <RotateCcw size={15} aria-label="Turnaround" />}
            </li>
          ))}
        </ol>
      </div>

      <p className="route-note">
        <Info size={16} aria-hidden="true" />
        This is an illustrative sequence, not a navigation map. Follow the
        official briefing, signs and marshals on race day.
      </p>
    </section>
  );
}
