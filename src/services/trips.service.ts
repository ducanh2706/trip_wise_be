import { Trip } from '@/models/Trip.model';
import { Activity } from '@/models/Activity.model';
import { Location } from '@/models/Location.model';
import { createNotification } from '@/services/notifications.service';

export interface TripCompanion {
  name: string;
  image: string | null;
}

export interface TripItem {
  time: string;
  title: string;
  location: string;
  category: string;
  activityId: number | null;
  companions: TripCompanion[];
}

export interface TripDay {
  dayIndex: number;
  date: string | null;
  items: TripItem[];
}

export interface TripSummary {
  id: string;
  title: string;
  destination: string | null;
  status: string;
  statusLabel: string;
  coverImage: string | null;
  mapImage: string | null;
  startDate: string | null;
  endDate: string | null;
  days: TripDay[];
}

/** A thrown error the controller maps to a 4xx instead of a 500. */
export class TripError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const STATUS_LABEL: Record<string, string> = {
  ONGOING: 'ONGOING TRIP',
  UPCOMING: 'UPCOMING TRIP',
  COMPLETED: 'COMPLETED TRIP',
};
// Sort so the screen's default pick (ONGOING) is first.
const STATUS_ORDER: Record<string, number> = {
  ONGOING: 0,
  UPCOMING: 1,
  COMPLETED: 2,
};

// Time slots a freshly-added item drops into, by current item count.
const TIME_SLOTS = [
  '08:30',
  '10:00',
  '12:30',
  '15:00',
  '17:30',
  '20:00',
  '21:30',
];

/* eslint-disable @typescript-eslint/no-explicit-any */
function mapTrip(d: any): TripSummary {
  const status = d.status ?? 'UPCOMING';
  return {
    id: d._id,
    title: d.title,
    destination: d.destination ?? null,
    status,
    statusLabel: STATUS_LABEL[status] ?? 'TRIP',
    coverImage: d.cover_image ?? null,
    mapImage: d.map_image ?? null,
    startDate: d.start_date ?? null,
    endDate: d.end_date ?? null,
    days: (d.days ?? []).map((day: any) => ({
      dayIndex: day.day_index,
      date: day.date ?? null,
      items: (day.items ?? []).map((it: any) => ({
        time: it.time,
        title: it.title,
        location: it.location_name ?? '',
        category: it.category ?? 'SIGHTSEEING',
        activityId: it.activity_id ?? null,
        companions: (it.companions ?? []).map((c: any) => ({
          name: c.name,
          image: c.image ?? null,
        })),
      })),
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function resolveLocationName(id: number): Promise<string> {
  const loc = await Location.findById(id).lean();
  if (!loc) return '';
  const parent =
    loc.parent_id != null ? await Location.findById(loc.parent_id).lean() : null;
  return parent ? `${loc.name}, ${parent.name}` : loc.name;
}

export async function getTrips(userId: string): Promise<{ trips: TripSummary[] }> {
  const docs = await Trip.find({ user_id: userId }).lean();
  const trips = docs
    .map(mapTrip)
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    );
  return { trips };
}

/** Append a real activity as a timed item on one day of a trip. */
export async function addTripItem(
  userId: string,
  tripId: string,
  dayIndex: number,
  activityId: number,
): Promise<TripSummary> {
  if (!tripId || !Number.isInteger(dayIndex) || !Number.isInteger(activityId)) {
    throw new TripError(400, 'tripId, dayIndex and activityId are required');
  }

  const trip = await Trip.findOne({
    _id: tripId,
    user_id: userId,
  }).lean();
  if (!trip) throw new TripError(404, 'Trip not found');

  const activity = await Activity.findOne({
    _id: activityId,
    status: 'LIVE',
    deleted_at: null,
  }).lean();
  if (!activity) throw new TripError(404, 'Activity not found');

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const day = (trip.days ?? []).find(
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (d: any) => d.day_index === dayIndex,
  );
  if (!day) throw new TripError(400, `Day ${dayIndex} does not exist`);

  const count = Array.isArray(day.items) ? day.items.length : 0;
  const time = TIME_SLOTS[Math.min(count, TIME_SLOTS.length - 1)];
  const newItem = {
    time,
    title: activity.title,
    location_name: await resolveLocationName(activity.location_id),
    category: activity.category ?? 'SIGHTSEEING',
    activity_id: activity._id,
    companions: [],
  };

  await Trip.updateOne(
    { _id: tripId, 'days.day_index': dayIndex },
    {
      $push: { 'days.$.items': newItem },
      $set: { updated_at: new Date().toISOString() },
    },
  );

  await createNotification({
    userId,
    type: 'TRIP',
    title: 'Activity added to your trip',
    // dayIndex is the real 1-based day_index (no +1).
    body: `"${activity.title}" was added to day ${dayIndex}.`,
    actionRoute: `/trip_planner_timeline?id=${tripId}`,
  });

  const updated = await Trip.findById(tripId).lean();
  return mapTrip(updated);
}
