import { useEffect, useState } from 'react';
import { LoaderCircle, MapPinned, Route, ShieldCheck } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import './member-route-timeline.css';

type RouteDistance = '5' | '10' | '21';

type RouteTimeline = {
  start: string;
  distances: Array<{
    distance: RouteDistance;
    steps: string[];
  }>;
  notice?: string;
};

type MemberRouteResponse = {
  published: boolean;
  revision?: number;
  updated_at?: string;
  timeline?: RouteTimeline;
};

const routeDistances: RouteDistance[] = ['5', '10', '21'];

function readText(value: unknown, limit: number) {
  return typeof value === 'string' && value.trim().length <= limit
    ? value.trim()
    : null;
}

function readRoute(value: unknown): MemberRouteResponse {
  if (!value || typeof value !== 'object') return { published: false };
  const source = value as Record<string, unknown>;
  if (source.published !== true) return { published: false };
  if (!source.timeline || typeof source.timeline !== 'object') {
    return { published: false };
  }

  const timeline = source.timeline as Record<string, unknown>;
  const start = readText(timeline.start, 180);
  const notice = readText(timeline.notice, 500) ?? undefined;
  if (!start || !Array.isArray(timeline.distances)) return { published: false };

  const distances = timeline.distances
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const segment = item as Record<string, unknown>;
      const distance = routeDistances.includes(segment.distance as RouteDistance)
        ? (segment.distance as RouteDistance)
        : null;
      const steps = Array.isArray(segment.steps)
        ? segment.steps
            .map((step) => readText(step, 220))
            .filter((step): step is string => Boolean(step))
        : [];
      return distance && steps.length >= 2 ? { distance, steps } : null;
    })
    .filter(
      (segment): segment is RouteTimeline['distances'][number] =>
        Boolean(segment),
    )
    .sort(
      (left, right) =>
        routeDistances.indexOf(left.distance) -
        routeDistances.indexOf(right.distance),
    );

  if (
    distances.length !== 3 ||
    new Set(distances.map((segment) => segment.distance)).size !== 3
  ) {
    return { published: false };
  }

  return {
    published: true,
    revision: typeof source.revision === 'number' ? source.revision : undefined,
    updated_at: readText(source.updated_at, 80) ?? undefined,
    timeline: { start, distances, notice },
  };
}

function formatUpdate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

export function MemberRouteTimeline({
  eventId = 'suratgarh-2026',
}: {
  eventId?: string;
}) {
  const [route, setRoute] = useState<MemberRouteResponse | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    void (async () => {
      let next: MemberRouteResponse;
      try {
        const { data, error } = await supabase.rpc('get_member_route', {
          p_event_id: eventId,
        });
        next = error ? { published: false } : readRoute(data);
      } catch {
        next = { published: false };
      }
      if (!active) return;
      setRoute(next);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [eventId]);

  const update = route?.published ? formatUpdate(route.updated_at) : null;

  return (
    <section className="member-route" aria-labelledby="member-route-title">
      <div className="member-route__heading">
        <span>
          <Route size={17} /> MEMBER ROUTE
        </span>
        <h3 id="member-route-title">Your route timeline</h3>
      </div>

      {loading ? (
        <p className="member-route__loading" aria-live="polite">
          <LoaderCircle className="spin" size={17} /> Checking your route…
        </p>
      ) : !route?.published || !route.timeline ? (
        <div className="member-route__pending">
          <MapPinned size={23} />
          <p>Detailed route directions will appear here once released by the station.</p>
        </div>
      ) : (
        <>
          <div className="member-route__start">
            <MapPinned size={20} />
            <div>
              <small>START / FINISH</small>
              <strong>{route.timeline.start}</strong>
            </div>
          </div>
          <div className="member-route__distances">
            {route.timeline.distances.map((segment) => (
              <article key={segment.distance}>
                <h4>{segment.distance} KM</h4>
                <ol>
                  {segment.steps.map((step) => (
                    <li key={step}>{step}</li>
                  ))}
                </ol>
              </article>
            ))}
          </div>
          {route.timeline.notice && (
            <p className="member-route__notice">
              <ShieldCheck size={16} /> {route.timeline.notice}
            </p>
          )}
          {update && <small className="member-route__update">Updated {update}</small>}
        </>
      )}
    </section>
  );
}
