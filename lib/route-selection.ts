export const ROUTE_DISTANCES = ['5', '10', '21'] as const;
export type RouteDistance = (typeof ROUTE_DISTANCES)[number];
export const DEFAULT_ROUTE_DISTANCE: RouteDistance = '5';

/** Returns a public route category without exposing route locations. */
export function routeDistanceFromSearch(search = ''): RouteDistance {
  const distance = new URLSearchParams(search).get('route');
  return ROUTE_DISTANCES.includes(distance as RouteDistance)
    ? (distance as RouteDistance)
    : DEFAULT_ROUTE_DISTANCE;
}
