import { Activity, type ActivityDoc } from '@/models/Activity.model';
import { Airport, type AirportDoc } from '@/models/Airport.model';
import { Booking, type BookingDoc } from '@/models/Booking.model';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { Flight, type FlightDoc } from '@/models/Flight.model';
import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Room, type RoomDoc } from '@/models/Room.model';
import { User, type UserDoc } from '@/models/User.model';
import { env } from '@/config/env';
import { createNotification } from '@/services/notifications.service';

const ORDER_LIMIT = 50;
const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1566073771259-6a8506099945?auto=format&fit=crop&w=1200&q=80';

export type OrderStatus = 'pending' | 'confirmed' | 'completed' | 'cancelled';

const statusAliases: Record<string, OrderStatus> = {
  pending: 'pending',
  requested: 'pending',
  awaiting_approval: 'pending',
  paid: 'confirmed',
  confirmed: 'confirmed',
  accepted: 'confirmed',
  approved: 'confirmed',
  completed: 'completed',
  done: 'completed',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  rejected: 'cancelled',
};

const dbStatusesByOrderStatus: Record<OrderStatus, string[]> = {
  pending: ['PENDING', 'REQUESTED', 'AWAITING_APPROVAL'],
  confirmed: ['CONFIRMED', 'PAID', 'ACCEPTED', 'APPROVED'],
  completed: ['COMPLETED', 'DONE'],
  cancelled: ['CANCELLED', 'CANCELED', 'REJECTED'],
};

type LeanBooking = Pick<
  BookingDoc,
  | '_id'
  | 'user_id'
  | 'total_price'
  | 'total_amount'
  | 'final_amount'
  | 'status'
  | 'created_at'
  | 'updated_at'
>;
type LeanBookingItem = BookingItemDoc;
type LeanUser = Pick<UserDoc, '_id' | 'full_name' | 'email' | 'image'>;
type LeanHotel = Pick<HotelDoc, '_id' | 'name' | 'image' | 'images'>;
type LeanRoom = Pick<RoomDoc, '_id' | 'hotel_id' | 'room_type' | 'image'>;
type LeanFlight = Pick<
  FlightDoc,
  '_id' | 'flight_number' | 'departure_airport' | 'arrival_airport' | 'image'
>;
type LeanAirport = Pick<AirportDoc, '_id' | 'name'>;
type LeanActivity = Pick<ActivityDoc, '_id' | 'title' | 'type' | 'image'>;
type BookingItemFilter = Record<string, unknown>;

export interface ProviderOrderItem {
  id: string;
  bookingId: string;
  status: OrderStatus;
  statusLabel: string;
  title: string;
  guestName: string;
  guestAvatarUrl: string | null;
  dates: string;
  checkIn: string | null;
  checkOut: string | null;
  nights: number | null;
  guests: number | null;
  totalPrice: number;
  currency: string;
  displayPrice: string;
  bookingType: 'standard' | 'premium';
  imageUrl: string;
  roomType: string | null;
  serviceType: 'hotel' | 'flight' | 'activity';
  createdAt: string | null;
  updatedAt: string | null;
}

export interface ProviderOrdersResponse {
  status: OrderStatus | 'all';
  counts: Record<OrderStatus, number>;
  orders: ProviderOrderItem[];
}

function normalizeStatus(value: unknown): OrderStatus {
  if (typeof value !== 'string') return 'pending';
  return statusAliases[value.trim().toLowerCase()] ?? 'pending';
}

export function parseOrderStatus(value: unknown): OrderStatus | 'all' {
  if (typeof value !== 'string' || value.trim().length === 0) return 'pending';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'all') return 'all';
  return statusAliases[normalized] ?? 'pending';
}

function buildStatusLabel(status: OrderStatus): string {
  switch (status) {
    case 'confirmed':
      return 'CONFIRMED';
    case 'completed':
      return 'COMPLETED';
    case 'cancelled':
      return 'CANCELLED';
    case 'pending':
    default:
      return 'PENDING';
  }
}

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: currency === 'VND' ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString('en-US')} ${currency}`;
  }
}

function formatDateRange(checkIn?: string, checkOut?: string): string {
  if (!checkIn && !checkOut) return 'Dates not set';

  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });

  const formatOne = (value: string | undefined): string | null => {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : formatter.format(date);
  };

  const start = formatOne(checkIn);
  const end = formatOne(checkOut);

  if (start && end) return `${start} - ${end}`;
  return start ?? end ?? 'Dates not set';
}

function diffNights(checkIn?: string, checkOut?: string): number | null {
  if (!checkIn || !checkOut) return null;
  const start = new Date(checkIn);
  const end = new Date(checkOut);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
}

function pickFirstImage(values: Array<string | null | undefined>): string {
  return (
    values.find((value) => typeof value === 'string' && value.trim().length > 0) ?? DEFAULT_IMAGE
  );
}

function buildFilter(providerId?: string, status?: OrderStatus | 'all'): BookingItemFilter {
  const filter: BookingItemFilter = {};

  if (providerId) {
    filter.provider_id = providerId;
  }

  if (status && status !== 'all') {
    filter.item_status = { $in: dbStatusesByOrderStatus[status] };
  }

  return filter;
}

function compactNumbers(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((value): value is number => typeof value === 'number')));
}

function compactStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(
      values.filter((value): value is string => typeof value === 'string' && value.length > 0),
    ),
  );
}

async function loadBookings(ids: string[]): Promise<Map<string, LeanBooking>> {
  if (ids.length === 0) return new Map();

  const bookings = (await Booking.find({ _id: { $in: ids } })
    .select({
      _id: 1,
      user_id: 1,
      total_price: 1,
      total_amount: 1,
      final_amount: 1,
      status: 1,
      created_at: 1,
      updated_at: 1,
    })
    .lean()) as LeanBooking[];

  return new Map(bookings.map((booking) => [String(booking._id), booking] as const));
}

async function loadUsers(ids: string[]): Promise<Map<string, LeanUser>> {
  if (ids.length === 0) return new Map();

  const users = (await User.find({ _id: { $in: ids } })
    .select({ _id: 1, full_name: 1, email: 1, image: 1 })
    .lean()) as LeanUser[];

  return new Map(users.map((user) => [user._id, user] as const));
}

async function loadRooms(ids: number[]): Promise<Map<number, LeanRoom>> {
  if (ids.length === 0) return new Map();

  const rooms = (await Room.find({ _id: { $in: ids }, deleted_at: null })
    .select({ _id: 1, hotel_id: 1, room_type: 1, image: 1 })
    .lean()) as LeanRoom[];

  return new Map(rooms.map((room) => [room._id, room] as const));
}

async function loadHotels(ids: number[]): Promise<Map<number, LeanHotel>> {
  if (ids.length === 0) return new Map();

  const hotels = (await Hotel.find({ _id: { $in: ids }, deleted_at: null })
    .select({ _id: 1, name: 1, image: 1, images: 1 })
    .lean()) as LeanHotel[];

  return new Map(hotels.map((hotel) => [hotel._id, hotel] as const));
}

async function loadFlights(ids: number[]): Promise<Map<number, LeanFlight>> {
  if (ids.length === 0) return new Map();

  const flights = (await Flight.find({ _id: { $in: ids }, deleted_at: null })
    .select({
      _id: 1,
      flight_number: 1,
      departure_airport: 1,
      arrival_airport: 1,
      image: 1,
    })
    .lean()) as LeanFlight[];

  return new Map(flights.map((flight) => [flight._id, flight] as const));
}

async function loadActivities(ids: number[]): Promise<Map<number, LeanActivity>> {
  if (ids.length === 0) return new Map();

  const activities = (await Activity.find({ _id: { $in: ids }, deleted_at: null })
    .select({ _id: 1, title: 1, type: 1, image: 1 })
    .lean()) as LeanActivity[];

  return new Map(activities.map((activity) => [activity._id, activity] as const));
}

async function loadAirports(codes: string[]): Promise<Map<string, LeanAirport>> {
  if (codes.length === 0) return new Map();

  const airports = (await Airport.find({ _id: { $in: codes } })
    .select({ _id: 1, name: 1 })
    .lean()) as LeanAirport[];

  return new Map(airports.map((airport) => [airport._id, airport] as const));
}

function buildFlightTitle(
  flight: LeanFlight | undefined,
  airportMap: Map<string, LeanAirport>,
): string {
  if (!flight) return 'Flight booking';
  const departure = airportMap.get(flight.departure_airport);
  const arrival = airportMap.get(flight.arrival_airport);
  return `${departure?._id ?? flight.departure_airport} - ${arrival?._id ?? flight.arrival_airport} (${flight.flight_number})`;
}

function toOrderItem(
  item: LeanBookingItem,
  context: {
    bookingMap: Map<string, LeanBooking>;
    userMap: Map<string, LeanUser>;
    roomMap: Map<number, LeanRoom>;
    hotelMap: Map<number, LeanHotel>;
    flightMap: Map<number, LeanFlight>;
    activityMap: Map<number, LeanActivity>;
    airportMap: Map<string, LeanAirport>;
  },
): ProviderOrderItem {
  const booking = context.bookingMap.get(item.booking_id);
  const user = booking?.user_id ? context.userMap.get(booking.user_id) : undefined;
  const room = item.room_id ? context.roomMap.get(item.room_id) : undefined;
  const hotel = room ? context.hotelMap.get(room.hotel_id) : undefined;
  const flight = item.flight_id ? context.flightMap.get(item.flight_id) : undefined;
  const activity = item.activity_id ? context.activityMap.get(item.activity_id) : undefined;
  const status = normalizeStatus(item.item_status);
  const totalPrice =
    typeof item.total_price === 'number' && Number.isFinite(item.total_price)
      ? item.total_price
      : 0;
  const serviceType = item.room_id ? 'hotel' : item.flight_id ? 'flight' : 'activity';

  return {
    id: item._id,
    bookingId: item.booking_id,
    status,
    statusLabel: buildStatusLabel(status),
    title: hotel?.name ?? activity?.title ?? buildFlightTitle(flight, context.airportMap),
    guestName: user?.full_name ?? user?.email ?? 'Guest',
    guestAvatarUrl: user?.image ?? null,
    dates: formatDateRange(item.start_date ?? undefined, item.end_date ?? undefined),
    checkIn: item.start_date ?? null,
    checkOut: item.end_date ?? null,
    nights: diffNights(item.start_date ?? undefined, item.end_date ?? undefined),
    guests: item.quantity ?? null,
    totalPrice,
    currency: 'VND',
    displayPrice: formatCurrency(totalPrice, 'VND'),
    bookingType: totalPrice >= 5_000_000 ? 'premium' : 'standard',
    imageUrl: pickFirstImage([
      room?.image,
      ...(hotel?.images ?? []),
      hotel?.image,
      flight?.image,
      activity?.image,
    ]),
    roomType: room?.room_type ?? null,
    serviceType,
    createdAt: item.created_at ?? booking?.created_at ?? null,
    updatedAt: item.updated_at ?? booking?.updated_at ?? null,
  };
}

async function buildContext(items: LeanBookingItem[]): Promise<Parameters<typeof toOrderItem>[1]> {
  const bookingMap = await loadBookings(compactStrings(items.map((item) => item.booking_id)));
  const userMap = await loadUsers(
    compactStrings(Array.from(bookingMap.values()).map((booking) => booking.user_id)),
  );
  const roomMap = await loadRooms(compactNumbers(items.map((item) => item.room_id)));
  const hotelMap = await loadHotels(
    compactNumbers(Array.from(roomMap.values()).map((room) => room.hotel_id)),
  );
  const flightMap = await loadFlights(compactNumbers(items.map((item) => item.flight_id)));
  const airportMap = await loadAirports(
    compactStrings(
      Array.from(flightMap.values()).flatMap((flight) => [
        flight.departure_airport,
        flight.arrival_airport,
      ]),
    ),
  );
  const activityMap = await loadActivities(compactNumbers(items.map((item) => item.activity_id)));

  return {
    bookingMap,
    userMap,
    roomMap,
    hotelMap,
    flightMap,
    activityMap,
    airportMap,
  };
}

export async function getProviderOrders(input: {
  providerId?: string;
  status?: string;
}): Promise<ProviderOrdersResponse> {
  const selectedStatus = parseOrderStatus(input.status);
  const baseFilter = buildFilter(input.providerId);
  const statusFilter = buildFilter(input.providerId, selectedStatus);

  const [items, countsByStatus] = await Promise.all([
    BookingItem.find(statusFilter).sort({ created_at: -1, _id: -1 }).limit(ORDER_LIMIT).lean(),
    BookingItem.find(baseFilter).select({ item_status: 1 }).lean(),
  ]);

  const counts: Record<OrderStatus, number> = {
    pending: 0,
    confirmed: 0,
    completed: 0,
    cancelled: 0,
  };

  for (const item of countsByStatus as Array<Pick<LeanBookingItem, 'item_status'>>) {
    counts[normalizeStatus(item.item_status)] += 1;
  }

  const leanItems = items as LeanBookingItem[];
  const context = await buildContext(leanItems);

  return {
    status: selectedStatus,
    counts,
    orders: leanItems.map((item) => toOrderItem(item, context)),
  };
}

export async function updateOrderStatus(
  id: string,
  status: OrderStatus,
): Promise<ProviderOrderItem | null> {
  const now = new Date().toISOString();
  const dbStatus = dbStatusesByOrderStatus[status][0];
  const updated = await BookingItem.findByIdAndUpdate(
    id,
    { item_status: dbStatus, updated_at: now },
    { returnDocument: 'after' },
  ).lean();

  if (!updated) return null;

  // Provider-triggered, but notifies the booking owner. In this no-auth
  // prototype the inbox is pinned to env.demoUserId, so target that so the
  // push lands on the same device the inbox shows.
  await createNotification({
    userId: env.demoUserId,
    type: 'BOOKING',
    title: `Booking ${status}`,
    body: `Your booking status changed to ${status}.`,
    actionRoute: '/my_trips',
  });

  const item = updated as LeanBookingItem;
  const context = await buildContext([item]);
  return toOrderItem(item, context);
}
