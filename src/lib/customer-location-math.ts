// Finding customer locations that were captured wrongly.
//
// The driver app saves a customer's coordinates from the first delivery that
// gets a GPS fix. Usually that's the doorstep. Sometimes it isn't — a fix taken
// from the moving vehicle, a stale position, or a delivery marked several
// streets later. Nothing downstream notices, and the wrong pin then drives
// navigation on every future visit.
//
// A route is geographically tight by nature: it's one round, walked or driven
// in sequence. So a customer sitting far from the rest of that route's cluster
// is the signal worth surfacing. Compared against the MEDIAN rather than the
// mean, because the mean is dragged by the very outliers being looked for —
// two bad pins would pull the centre toward themselves and make each other
// look reasonable.

export type LocatedCustomer = {
  customerId: string;
  latitude: number;
  longitude: number;
};

export type LocationOutlier = {
  customerId: string;
  distanceKm: number;
};

const EARTH_RADIUS_KM = 6371;

export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

// The route's centre, as the median latitude and longitude independently. Not a
// true geometric median, but for a delivery round — a few streets across, far
// from the poles or the date line — it lands in the right place and is trivial
// to reason about.
export function routeCentre(customers: LocatedCustomer[]): { latitude: number; longitude: number } | null {
  if (customers.length === 0) {
    return null;
  }
  return {
    latitude: median(customers.map((customer) => customer.latitude)),
    longitude: median(customers.map((customer) => customer.longitude)),
  };
}

// Customers further than `thresholdKm` from the route's centre, worst first.
//
// Returns nothing below a handful of customers: with two or three pins there's
// no meaningful centre to be far from, and flagging one of three as an outlier
// is noise rather than a finding.
export function findLocationOutliers(
  customers: LocatedCustomer[],
  thresholdKm = 2,
  minimumSampleSize = 5,
): LocationOutlier[] {
  if (customers.length < minimumSampleSize) {
    return [];
  }

  const centre = routeCentre(customers);
  if (!centre) {
    return [];
  }

  return customers
    .map((customer) => ({
      customerId: customer.customerId,
      distanceKm: haversineKm(centre.latitude, centre.longitude, customer.latitude, customer.longitude),
    }))
    .filter((entry) => entry.distanceKm > thresholdKm)
    .sort((left, right) => right.distanceKm - left.distanceKm);
}

// Rejects coordinates that can't be a real delivery address: the null island at
// 0,0 that a failed fix produces, and anything outside valid ranges.
export function isPlausibleCoordinate(latitude: number, longitude: number): boolean {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return false;
  }
  if (latitude === 0 && longitude === 0) {
    return false;
  }
  return latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}
