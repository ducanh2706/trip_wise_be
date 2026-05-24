import { Activity, type ActivityDoc } from '@/models/Activity.model';
import { Airport, type AirportDoc } from '@/models/Airport.model';
import { Booking, type BookingDoc } from '@/models/Booking.model';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { Flight, type FlightDoc } from '@/models/Flight.model';
import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Room, type RoomDoc } from '@/models/Room.model';
import { createNotification } from '@/services/notifications.service';

type UiTab = 'upcoming' | 'completed' | 'cancelled';
type ServiceType = 'hotel' | 'flight' | 'activity';

type LeanBooking = Pick<BookingDoc, '_id' | 'created_at' | 'updated_at' | 'status'>;
type LeanItem = BookingItemDoc;
type LeanRoom = Pick<RoomDoc, '_id' | 'hotel_id' | 'room_type' | 'image'>;
type LeanHotel = Pick<HotelDoc, '_id' | 'name' | 'address' | 'image' | 'images'>;
type LeanFlight = Pick<
  FlightDoc,
  '_id' | 'flight_number' | 'departure_airport' | 'arrival_airport' | 'image'
>;
type LeanAirport = Pick<AirportDoc, '_id' | 'name'>;
type LeanActivity = Pick<ActivityDoc, '_id' | 'title' | 'image' | 'type'>;

export interface MyTripCard {
  id: string;
  bookingId: string;
  title: string;
  subtitle: string;
  serviceType: ServiceType;
  status: UiTab;
  rawStatus: string;
  statusLabel: string;
  dateLabel: string;
  amount: number;
  amountLabel: string;
  imageUrl: string;
  route: string;
  ticketCode: string;
  canCancel: boolean;
  isCancellationPending: boolean;
  cancelDeadline: string | null;
  cancelDeadlineLabel: string | null;
}

export interface MyTripsResponse {
  selectedTab: UiTab;
  counts: Record<UiTab, number>;
  featured: MyTripCard | null;
  items: MyTripCard[];
}

export interface CancelMyTripResponse {
  bookingId: string;
  bookingItemId: string;
  status: 'CANCELLED' | 'CANCELLATION_PENDING';
  message: string;
  cancelDeadline: string | null;
  cancelDeadlineLabel: string | null;
}

export class MyTripsError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80';
const STATUS_ALIASES: Record<string, UiTab> = {
  PENDING: 'upcoming',
  REQUESTED: 'upcoming',
  AWAITING_APPROVAL: 'upcoming',
  CONFIRMED: 'upcoming',
  PAID: 'upcoming',
  ACCEPTED: 'upcoming',
  APPROVED: 'upcoming',
  CANCELLATION_PENDING: 'upcoming',
  COMPLETED: 'completed',
  DONE: 'completed',
  CANCELLED: 'cancelled',
  CANCELED: 'cancelled',
  REJECTED: 'cancelled',
};
const CANCELLED_ITEM_STATUSES = new Set(['CANCELLED', 'CANCELED', 'REJECTED']);
const CANCELLATION_PENDING_STATUSES = new Set(['CANCELLATION_PENDING']);
const CANCELLABLE_ITEM_STATUSES = new Set([
  'PENDING',
  'REQUESTED',
  'AWAITING_APPROVAL',
  'CONFIRMED',
  'PAID',
  'ACCEPTED',
  'APPROVED',
]);
const SHORT_NOTICE_DAYS = 7;
const SHORT_NOTICE_CANCEL_WINDOW_DAYS = 1;
const STANDARD_CANCEL_WINDOW_DAYS = 7;

function normalizeTab(value: unknown): UiTab {
  if (value === 'completed') return 'completed';
  if (value === 'cancelled') return 'cancelled';
  return 'upcoming';
}

function normalizeItemStatus(value: unknown): UiTab {
  if (typeof value !== 'string') return 'upcoming';
  const key = value.trim().toUpperCase();
  return STATUS_ALIASES[key] ?? 'upcoming';
}

function normalizeMaybeBookingId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeRawStatus(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

function formatDateRange(start?: string | null, end?: string | null): string {
  const fmt = (v?: string | null): string | null => {
    if (!v) return null;
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  };
  const s = fmt(start);
  const e = fmt(end);
  if (s && e) return `${s} - ${e}`;
  return s ?? e ?? 'Dates to be confirmed';
}

function formatAmount(amount: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 2,
    }).format(Math.round(amount));
  } catch {
    return `$${Math.round(amount).toLocaleString('en-US')}`;
  }
}

function pickImage(values: Array<string | null | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return DEFAULT_IMAGE;
}

function firstNumber(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((v): v is number => typeof v === 'number')));
}

function firstString(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  );
}

function serviceTypeOf(item: LeanItem): ServiceType {
  if (item.room_id != null) return 'hotel';
  if (item.flight_id != null) return 'flight';
  return 'activity';
}

function statusLabel(tab: UiTab): string {
  if (tab === 'completed') return 'Completed';
  if (tab === 'cancelled') return 'Cancelled';
  return 'Upcoming';
}

function itemStatusLabel(rawStatus: string, tab: UiTab): string {
  if (isCancellationPendingStatus(rawStatus)) return 'Cancellation pending';
  return statusLabel(tab);
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = value.length <= 10 ? new Date(`${value}T00:00:00.000Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function formatDeadline(value: string | null): string | null {
  const date = parseDate(value);
  if (!date) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function cancellationDeadline(item: LeanItem, booking?: LeanBooking): Date {
  const bookedAt = parseDate(booking?.created_at) ?? parseDate(item.created_at) ?? new Date();
  const startDate = parseDate(item.start_date);
  const daysUntilStart =
    startDate == null
      ? Number.POSITIVE_INFINITY
      : Math.ceil((startDate.getTime() - bookedAt.getTime()) / 86_400_000);
  const windowDays =
    daysUntilStart <= SHORT_NOTICE_DAYS
      ? SHORT_NOTICE_CANCEL_WINDOW_DAYS
      : STANDARD_CANCEL_WINDOW_DAYS;
  return addDays(bookedAt, windowDays);
}

function cancellationPolicy(item: LeanItem, booking?: LeanBooking) {
  const deadline = cancellationDeadline(item, booking);
  const deadlineIso = deadline.toISOString();
  const rawStatus = normalizeRawStatus(item.item_status ?? booking?.status);
  return {
    deadlineIso,
    deadlineLabel: formatDeadline(deadlineIso),
    canCancel: isCancellableStatus(rawStatus) && Date.now() <= deadline.getTime(),
    isPending: isCancellationPendingStatus(rawStatus),
  };
}

function itemTs(item: LeanItem, booking?: LeanBooking): number {
  const raw = item.start_date ?? item.created_at ?? booking?.created_at ?? '1970-01-01';
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export async function getMyTrips(
  userId: string,
  statusInput?: unknown,
  focusBookingIdInput?: unknown,
): Promise<MyTripsResponse> {
  const selectedTab = normalizeTab(statusInput);
  const focusBookingId = normalizeMaybeBookingId(focusBookingIdInput);

  const bookings = (await Booking.find({ user_id: userId })
    .select({ _id: 1, created_at: 1, updated_at: 1, status: 1 })
    .lean()) as LeanBooking[];
  const bookingIds = firstString(bookings.map((b) => String(b._id)));
  const bookingMap = new Map(bookings.map((b) => [String(b._id), b] as const));

  if (bookingIds.length === 0) {
    return {
      selectedTab,
      counts: { upcoming: 0, completed: 0, cancelled: 0 },
      featured: null,
      items: [],
    };
  }

  const items = (await BookingItem.find({ booking_id: { $in: bookingIds } })
    .sort({ created_at: -1, _id: -1 })
    .lean()) as LeanItem[];

  const roomIds = firstNumber(items.map((item) => item.room_id));
  const flightIds = firstNumber(items.map((item) => item.flight_id));
  const activityIds = firstNumber(items.map((item) => item.activity_id));

  const rooms = (await Room.find({ _id: { $in: roomIds } })
    .select({ _id: 1, hotel_id: 1, room_type: 1, image: 1 })
    .lean()) as LeanRoom[];
  const roomMap = new Map(rooms.map((room) => [room._id, room] as const));

  const hotels = (await Hotel.find({
    _id: { $in: firstNumber(rooms.map((room) => room.hotel_id)) },
    deleted_at: null,
  })
    .select({ _id: 1, name: 1, address: 1, image: 1, images: 1 })
    .lean()) as LeanHotel[];
  const hotelMap = new Map(hotels.map((hotel) => [hotel._id, hotel] as const));

  const flights = (await Flight.find({ _id: { $in: flightIds }, deleted_at: null })
    .select({
      _id: 1,
      flight_number: 1,
      departure_airport: 1,
      arrival_airport: 1,
      image: 1,
    })
    .lean()) as LeanFlight[];
  const flightMap = new Map(flights.map((flight) => [flight._id, flight] as const));

  const airports = (await Airport.find({
    _id: {
      $in: firstString(
        flights.flatMap((flight) => [flight.departure_airport, flight.arrival_airport]),
      ),
    },
  })
    .select({ _id: 1, name: 1 })
    .lean()) as LeanAirport[];
  const airportMap = new Map(airports.map((airport) => [airport._id, airport] as const));

  const activities = (await Activity.find({ _id: { $in: activityIds }, deleted_at: null })
    .select({ _id: 1, title: 1, image: 1, type: 1 })
    .lean()) as LeanActivity[];
  const activityMap = new Map(activities.map((activity) => [activity._id, activity] as const));

  const mapped: MyTripCard[] = items.map((item) => {
    const type = serviceTypeOf(item);
    const booking = bookingMap.get(item.booking_id);
    const rawStatus = normalizeRawStatus(item.item_status ?? booking?.status) || 'PENDING';
    const tab = normalizeItemStatus(rawStatus);
    const cancelPolicy = cancellationPolicy(item, booking);
    const amount =
      typeof item.total_price === 'number' && Number.isFinite(item.total_price)
        ? item.total_price
        : 0;

    if (type === 'hotel') {
      const room = item.room_id != null ? roomMap.get(item.room_id) : undefined;
      const hotel = room ? hotelMap.get(room.hotel_id) : undefined;
      return {
        id: item._id,
        bookingId: item.booking_id,
        title: hotel?.name ?? 'Hotel booking',
        subtitle: room?.room_type
          ? `${room.room_type} • ${hotel?.address ?? 'Tripwise listing'}`
          : hotel?.address ?? 'Tripwise listing',
        serviceType: 'hotel',
        status: tab,
        rawStatus,
        statusLabel: itemStatusLabel(rawStatus, tab),
        dateLabel: formatDateRange(item.start_date, item.end_date),
        amount,
        amountLabel: formatAmount(amount),
        imageUrl: pickImage([room?.image, ...(hotel?.images ?? []), hotel?.image]),
        route: hotel ? `/service_details/${hotel._id}` : '/my_trips',
        ticketCode: item.e_ticket_code ?? '',
        canCancel: cancelPolicy.canCancel,
        isCancellationPending: cancelPolicy.isPending,
        cancelDeadline: cancelPolicy.deadlineIso,
        cancelDeadlineLabel: cancelPolicy.deadlineLabel,
      };
    }

    if (type === 'flight') {
      const flight = item.flight_id != null ? flightMap.get(item.flight_id) : undefined;
      const dep = flight ? airportMap.get(flight.departure_airport) : undefined;
      const arr = flight ? airportMap.get(flight.arrival_airport) : undefined;
      return {
        id: item._id,
        bookingId: item.booking_id,
        title: flight?.flight_number
          ? `Flight ${flight.flight_number}`
          : 'Flight booking',
        subtitle: flight
          ? `${dep?._id ?? flight.departure_airport} -> ${arr?._id ?? flight.arrival_airport}`
          : 'Flight route',
        serviceType: 'flight',
        status: tab,
        rawStatus,
        statusLabel: itemStatusLabel(rawStatus, tab),
        dateLabel: formatDateRange(item.start_date, item.end_date),
        amount,
        amountLabel: formatAmount(amount),
        imageUrl: pickImage([flight?.image]),
        route: '/my_trips',
        ticketCode: item.e_ticket_code ?? '',
        canCancel: cancelPolicy.canCancel,
        isCancellationPending: cancelPolicy.isPending,
        cancelDeadline: cancelPolicy.deadlineIso,
        cancelDeadlineLabel: cancelPolicy.deadlineLabel,
      };
    }

    const activity = item.activity_id != null ? activityMap.get(item.activity_id) : undefined;
    return {
      id: item._id,
      bookingId: item.booking_id,
      title: activity?.title ?? 'Activity booking',
      subtitle: activity?.type ? `${activity.type} activity` : 'Activity experience',
      serviceType: 'activity',
      status: tab,
      rawStatus,
      statusLabel: itemStatusLabel(rawStatus, tab),
      dateLabel: formatDateRange(item.start_date, item.end_date),
      amount,
      amountLabel: formatAmount(amount),
      imageUrl: pickImage([activity?.image]),
      route: '/my_trips',
      ticketCode: item.e_ticket_code ?? '',
      canCancel: cancelPolicy.canCancel,
      isCancellationPending: cancelPolicy.isPending,
      cancelDeadline: cancelPolicy.deadlineIso,
      cancelDeadlineLabel: cancelPolicy.deadlineLabel,
    };
  });

  const counts: Record<UiTab, number> = {
    upcoming: 0,
    completed: 0,
    cancelled: 0,
  };
  for (const card of mapped) counts[card.status] += 1;

  const itemById = new Map(items.map((item) => [item._id, item] as const));
  const sorted = mapped
    .slice()
    .sort((left, right) => {
      const lt = itemTs(itemById.get(left.id)!, bookingMap.get(left.bookingId));
      const rt = itemTs(itemById.get(right.id)!, bookingMap.get(right.bookingId));
      if (left.status === 'upcoming' && right.status === 'upcoming') return lt - rt;
      return rt - lt;
    });

  const baseFeatured = sorted.find((card) => card.status === 'upcoming') ?? sorted[0] ?? null;
  const filtered = sorted.filter((card) => card.status === selectedTab);
  const focusIndex =
    focusBookingId == null
      ? -1
      : filtered.findIndex((card) => card.bookingId === focusBookingId);
  const prioritized =
    focusIndex > 0
      ? [
          filtered[focusIndex],
          ...filtered.slice(0, focusIndex),
          ...filtered.slice(focusIndex + 1),
        ]
      : filtered;
  const featured =
    focusIndex >= 0
      ? filtered[focusIndex]
      : baseFeatured;

  return {
    selectedTab,
    counts,
    featured,
    items: prioritized,
  };
}

function isCancelledStatus(value: unknown): boolean {
  return CANCELLED_ITEM_STATUSES.has(normalizeRawStatus(value));
}

function isCancellationPendingStatus(value: unknown): boolean {
  return CANCELLATION_PENDING_STATUSES.has(normalizeRawStatus(value));
}

function isCancellableStatus(value: unknown): boolean {
  return CANCELLABLE_ITEM_STATUSES.has(normalizeRawStatus(value));
}

export async function cancelMyTrip(
  userId: string,
  bookingItemIdInput: unknown,
): Promise<CancelMyTripResponse> {
  const bookingItemId = normalizeMaybeBookingId(bookingItemIdInput);
  if (!bookingItemId) {
    throw new MyTripsError(400, 'Invalid booking item id');
  }

  const bookingItem = (await BookingItem.findById(bookingItemId).lean()) as LeanItem | null;
  if (!bookingItem) {
    throw new MyTripsError(404, 'Trip not found');
  }

  const booking = await Booking.findOne({
    _id: bookingItem.booking_id,
    user_id: userId,
  }).lean();
  if (!booking) {
    throw new MyTripsError(404, 'Trip not found');
  }

  if (isCancelledStatus(bookingItem.item_status)) {
    return {
      bookingId: bookingItem.booking_id,
      bookingItemId,
      status: 'CANCELLED',
      message: 'Trip has already been cancelled.',
      cancelDeadline: null,
      cancelDeadlineLabel: null,
    };
  }

  if (isCancellationPendingStatus(bookingItem.item_status)) {
    return {
      bookingId: bookingItem.booking_id,
      bookingItemId,
      status: 'CANCELLATION_PENDING',
      message: 'Cancellation request is already waiting for admin approval.',
      cancelDeadline: bookingItem.cancellation_deadline ?? null,
      cancelDeadlineLabel: formatDeadline(bookingItem.cancellation_deadline ?? null),
    };
  }

  if (!isCancellableStatus(bookingItem.item_status)) {
    throw new MyTripsError(409, 'This trip cannot be cancelled in its current status');
  }

  const policy = cancellationPolicy(bookingItem, booking);
  if (!policy.canCancel) {
    throw new MyTripsError(
      409,
      `Cancellation window has expired. Deadline was ${policy.deadlineLabel ?? 'earlier'}.`,
    );
  }

  const now = new Date().toISOString();
  await BookingItem.updateOne(
    { _id: bookingItemId },
    {
      $set: {
        item_status: 'CANCELLATION_PENDING',
        cancellation_previous_status: normalizeRawStatus(bookingItem.item_status) || 'PENDING',
        cancellation_requested_at: now,
        cancellation_requested_by: userId,
        cancellation_deadline: policy.deadlineIso,
        cancellation_status: 'PENDING',
        updated_at: now,
      },
    },
  );

  await Booking.updateOne(
    { _id: bookingItem.booking_id },
    { $set: { status: 'CANCELLATION_PENDING', updated_at: now } },
  );

  await createNotification({
    userId,
    type: 'BOOKING',
    title: 'Cancellation request sent',
    body: 'Your cancellation request is waiting for admin approval.',
    actionRoute: '/my_trips?status=upcoming',
  });

  return {
    bookingId: bookingItem.booking_id,
    bookingItemId,
    status: 'CANCELLATION_PENDING',
    message: 'Cancellation request sent. Admin will review your refund.',
    cancelDeadline: policy.deadlineIso,
    cancelDeadlineLabel: policy.deadlineLabel,
  };
}
