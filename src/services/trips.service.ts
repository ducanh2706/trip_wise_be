import { Trip } from '@/models/Trip.model';
import { env } from '@/config/env';

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

export async function getTrips(): Promise<{ trips: TripSummary[] }> {
  const docs = await Trip.find({ user_id: env.demoUserId }).lean();
  const trips = docs
    .map(mapTrip)
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9),
    );
  return { trips };
}
