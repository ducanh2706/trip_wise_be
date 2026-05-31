import { randomUUID } from 'node:crypto';
import { Trip } from '@/models/Trip.model';
import { Activity } from '@/models/Activity.model';
import { Airport } from '@/models/Airport.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { Flight } from '@/models/Flight.model';
import { Hotel } from '@/models/Hotel.model';
import { Location } from '@/models/Location.model';
import { Room } from '@/models/Room.model';
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

export interface CreateTripInput {
  title?: unknown;
  destination?: unknown;
  startDate?: unknown;
  endDate?: unknown;
}

export interface UpdateTripItemTimeInput {
  dayIndex?: unknown;
  itemIndex?: unknown;
  time?: unknown;
}

export interface AddTripItemInput {
  dayIndex?: unknown;
  activityId?: unknown;
  bookingItemId?: unknown;
  time?: unknown;
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
const TIME_SLOTS = ['08:30', '10:00', '12:30', '15:00', '17:30', '20:00', '21:30'];

const DEFAULT_COVER =
  'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1200&q=80';

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseTime(value: unknown): string | null {
  const time = stringValue(value);
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return null;
  }

  const [hour, minute] = time.split(':').map(Number);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }

  return time;
}

function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return null;
  }
  const date = new Date(`${value.trim()}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function deriveTripStatus(start: Date, end: Date): 'ONGOING' | 'UPCOMING' | 'COMPLETED' {
  const currentDate = new Date();
  const today = new Date(
    Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth(), currentDate.getUTCDate()),
  );
  if (end.getTime() < today.getTime()) return 'COMPLETED';
  if (start.getTime() > today.getTime()) return 'UPCOMING';
  return 'ONGOING';
}

function buildEmptyDays(start: Date, end: Date) {
  const msPerDay = 86_400_000;
  const totalDays = Math.min(
    30,
    Math.max(1, Math.round((end.getTime() - start.getTime()) / msPerDay) + 1),
  );

  return Array.from({ length: totalDays }, (_, index) => ({
    day_index: index + 1,
    date: dateOnly(addUtcDays(start, index)),
    items: [],
  }));
}

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
      items: (day.items ?? [])
        .map((it: any) => ({
          time: it.time,
          title: it.title,
          location: it.location_name ?? '',
          category: it.category ?? 'SIGHTSEEING',
          activityId: it.activity_id ?? null,
          companions: (it.companions ?? []).map((c: any) => ({
            name: c.name,
            image: c.image ?? null,
          })),
        }))
        .sort((a: TripItem, b: TripItem) => a.time.localeCompare(b.time)),
    })),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function resolveLocationName(id: number): Promise<string> {
  const loc = await Location.findById(id).lean();
  if (!loc) return '';
  const parent = loc.parent_id != null ? await Location.findById(loc.parent_id).lean() : null;
  return parent ? `${loc.name}, ${parent.name}` : loc.name;
}

function bookingItemIdValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function firstCategory(value: unknown): string {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (raw == 'FOOD' || raw == 'SIGHTSEEING' || raw == 'TRANSPORT' || raw == 'OUTDOORS') {
    return raw;
  }
  return 'SIGHTSEEING';
}

async function resolvePlannedItemFromBooking(userId: string, bookingItemId: string) {
  const item = (await BookingItem.findById(bookingItemId).lean()) as BookingItemDoc | null;
  if (!item) throw new TripError(404, 'Booked item not found');

  const booking = await Booking.findOne({ _id: item.booking_id, user_id: userId }).lean();
  if (!booking) throw new TripError(403, 'This booked item does not belong to your account');

  if (item.activity_id != null) {
    const activity = await Activity.findOne({
      _id: item.activity_id,
      status: 'LIVE',
      deleted_at: null,
    }).lean();
    if (!activity) throw new TripError(404, 'Booked activity is no longer available');
    return {
      title: activity.title,
      location: await resolveLocationName(activity.location_id),
      category: firstCategory(activity.category),
      activityId: activity._id as number,
      bookingItemId: item._id,
    };
  }

  if (item.flight_id != null) {
    const flight = await Flight.findOne({ _id: item.flight_id, deleted_at: null }).lean();
    if (!flight) throw new TripError(404, 'Booked flight is no longer available');
    const [dep, arr] = await Promise.all([
      Airport.findById(flight.departure_airport).lean(),
      Airport.findById(flight.arrival_airport).lean(),
    ]);
    return {
      title: flight.flight_number ? `Flight ${flight.flight_number}` : 'Flight',
      location: `${dep?._id ?? flight.departure_airport} -> ${arr?._id ?? flight.arrival_airport}`,
      category: 'TRANSPORT',
      activityId: null,
      bookingItemId: item._id,
    };
  }

  if (item.room_id != null) {
    const room = await Room.findOne({ _id: item.room_id, deleted_at: null }).lean();
    if (!room) throw new TripError(404, 'Booked room is no longer available');
    const hotel = await Hotel.findOne({ _id: room.hotel_id, deleted_at: null }).lean();
    return {
      title: hotel?.name ?? room.room_type ?? 'Hotel stay',
      location: hotel?.address ?? '',
      category: 'SIGHTSEEING',
      activityId: null,
      bookingItemId: item._id,
    };
  }

  throw new TripError(400, 'Booked item is not supported for planning');
}

export async function getTrips(userId: string): Promise<{ trips: TripSummary[] }> {
  const docs = await Trip.find({ user_id: userId }).lean();
  const trips = docs
    .map(mapTrip)
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9));
  return { trips };
}

export async function createTrip(userId: string, input: CreateTripInput): Promise<TripSummary> {
  const title = stringValue(input.title);
  const destination = stringValue(input.destination);
  const start = parseDateOnly(input.startDate);
  const end = parseDateOnly(input.endDate);

  if (!title) throw new TripError(400, 'Trip name is required');
  if (!destination) throw new TripError(400, 'Destination is required');
  if (!start || !end) throw new TripError(400, 'Start date and end date must be YYYY-MM-DD');
  const now = new Date();
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (start.getTime() < today.getTime() || end.getTime() < today.getTime()) {
    throw new TripError(400, 'Trip dates cannot be before today');
  }
  if (end.getTime() < start.getTime()) {
    throw new TripError(400, 'End date must be after start date');
  }

  const createdAt = new Date().toISOString();
  const id = `trip-${randomUUID()}`;
  const doc = await Trip.create({
    _id: id,
    user_id: userId,
    title,
    destination,
    status: deriveTripStatus(start, end),
    cover_image: DEFAULT_COVER,
    map_image: `https://picsum.photos/seed/${encodeURIComponent(id)}_map/400/400`,
    start_date: dateOnly(start),
    end_date: dateOnly(end),
    days: buildEmptyDays(start, end),
    created_at: createdAt,
    updated_at: createdAt,
  });

  await createNotification({
    userId,
    type: 'TRIP',
    title: 'Trip created',
    body: `"${title}" is ready for planning.`,
    actionRoute: `/trip_planner_timeline?id=${id}`,
  });

  return mapTrip(doc.toJSON());
}

export async function deleteTrip(userId: string, tripId: string): Promise<{ message: string }> {
  if (!tripId) {
    throw new TripError(400, 'Trip id is required');
  }

  const result = await Trip.deleteOne({ _id: tripId, user_id: userId });
  if (result.deletedCount === 0) {
    throw new TripError(404, 'Trip not found');
  }

  return { message: 'Trip deleted.' };
}

/** Append an item from booked tickets or catalog activity to one day of a trip. */
export async function addTripItem(
  userId: string,
  tripId: string,
  input: AddTripItemInput,
): Promise<TripSummary> {
  const dayIndex = Number(input.dayIndex);
  const activityId = Number(input.activityId);
  const bookingItemId = bookingItemIdValue(input.bookingItemId);
  const customTime = input.time == null ? null : parseTime(input.time);

  if (!tripId || !Number.isInteger(dayIndex)) {
    throw new TripError(400, 'tripId and dayIndex are required');
  }
  if (input.time != null && customTime == null) {
    throw new TripError(400, 'Time must be HH:mm');
  }
  if (!bookingItemId && !Number.isInteger(activityId)) {
    throw new TripError(400, 'Provide either bookingItemId or activityId');
  }

  const trip = await Trip.findOne({
    _id: tripId,
    user_id: userId,
  }).lean();
  if (!trip) throw new TripError(404, 'Trip not found');

  /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
  const day = (trip.days ?? []).find(
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    (d: any) => d.day_index === dayIndex,
  );
  if (!day) throw new TripError(400, `Day ${dayIndex} does not exist`);

  const source = bookingItemId
    ? await resolvePlannedItemFromBooking(userId, bookingItemId)
    : await (async () => {
        const activity = await Activity.findOne({
          _id: activityId,
          status: 'LIVE',
          deleted_at: null,
        }).lean();
        if (!activity) throw new TripError(404, 'Activity not found');
        return {
          title: activity.title,
          location: await resolveLocationName(activity.location_id),
          category: firstCategory(activity.category),
          activityId: activity._id as number,
          bookingItemId: null,
        };
      })();

  if (source.bookingItemId != null) {
    const exists = (trip.days ?? []).some((d: any) =>
      (d.items ?? []).some((it: any) => it.booking_item_id === source.bookingItemId),
    );
    if (exists) {
      throw new TripError(409, 'This booked ticket is already in your plan');
    }
  }

  const count = Array.isArray(day.items) ? day.items.length : 0;
  const time = customTime ?? TIME_SLOTS[Math.min(count, TIME_SLOTS.length - 1)];
  const newItem = {
    time,
    title: source.title,
    location_name: source.location,
    category: source.category,
    activity_id: source.activityId,
    booking_item_id: source.bookingItemId,
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
    body: `"${source.title}" was added to day ${dayIndex}.`,
    actionRoute: `/trip_planner_timeline?id=${tripId}`,
  });

  const updated = await Trip.findById(tripId).lean();
  return mapTrip(updated);
}

export async function updateTripItemTime(
  userId: string,
  tripId: string,
  input: UpdateTripItemTimeInput,
): Promise<TripSummary> {
  const dayIndex = Number(input.dayIndex);
  const itemIndex = Number(input.itemIndex);
  const time = parseTime(input.time);

  if (!tripId || !Number.isInteger(dayIndex) || !Number.isInteger(itemIndex)) {
    throw new TripError(400, 'tripId, dayIndex and itemIndex are required');
  }
  if (!time) {
    throw new TripError(400, 'Time must be HH:mm');
  }

  const trip = await Trip.findOne({ _id: tripId, user_id: userId }).lean();
  if (!trip) throw new TripError(404, 'Trip not found');

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const day = (trip.days ?? []).find((d: any) => d.day_index === dayIndex);
  if (!day) throw new TripError(400, `Day ${dayIndex} does not exist`);
  if (!Array.isArray(day.items) || itemIndex < 0 || itemIndex >= day.items.length) {
    throw new TripError(400, 'Activity item does not exist');
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  await Trip.updateOne(
    { _id: tripId, user_id: userId, 'days.day_index': dayIndex },
    {
      $set: {
        [`days.$.items.${itemIndex}.time`]: time,
        updated_at: new Date().toISOString(),
      },
    },
  );

  const updated = await Trip.findById(tripId).lean();
  return mapTrip(updated);
}
