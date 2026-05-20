import { Activity } from '@/models/Activity.model';
import { Airport } from '@/models/Airport.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Flight } from '@/models/Flight.model';
import { Hotel } from '@/models/Hotel.model';
import { Payment } from '@/models/Payment.model';
import { Room } from '@/models/Room.model';
import { User } from '@/models/User.model';

interface PaymentSuccessItem {
  id: string;
  serviceType: 'hotel' | 'flight' | 'activity';
  title: string;
  subtitle: string | null;
  startDate: string | null;
  endDate: string | null;
  dateLabel: string;
  guests: number | null;
  ticketCode: string;
  imageUrl: string;
  amount: number;
  displayAmount: string;
}

export interface PaymentSuccessResponse {
  bookingId: string;
  bookingCode: string;
  destination: string;
  destinationSubtitle: string | null;
  arrivalDate: string | null;
  arrivalDateLabel: string;
  imageUrl: string;
  status: string;
  statusLabel: string;
  message: string;
  emailSentTo: string | null;
  amount: number;
  displayAmount: string;
  currency: string;
  payment: {
    id: string | null;
    method: string | null;
    status: string | null;
    transactionId: string | null;
    paidAt: string | null;
  };
  ticket: {
    code: string;
    downloadUrl: string;
  };
  items: PaymentSuccessItem[];
}

class PaymentSuccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const DEFAULT_IMAGE =
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1200&q=80';

function firstNumber(values: Array<number | null | undefined>): number[] {
  return Array.from(new Set(values.filter((v): v is number => typeof v === 'number')));
}

function firstString(values: Array<string | null | undefined>): string[] {
  return Array.from(
    new Set(values.filter((v): v is string => typeof v === 'string' && v.length > 0)),
  );
}

function formatCurrency(value: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  } catch {
    return `${Math.round(value).toLocaleString('en-US')} ${currency}`;
  }
}

function formatDate(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    year: 'numeric',
  });
}

function dateRange(start?: string | null, end?: string | null): string {
  const s = formatDate(start);
  const e = formatDate(end);
  if (s && e) return `${s} — ${e}`;
  return s ?? e ?? 'Date not set';
}

function imageOf(...candidates: Array<string | null | undefined>): string {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c;
  }
  return DEFAULT_IMAGE;
}

function normalizeServiceType(item: {
  room_id?: number | null;
  flight_id?: number | null;
}): 'hotel' | 'flight' | 'activity' {
  if (item.room_id != null) return 'hotel';
  if (item.flight_id != null) return 'flight';
  return 'activity';
}

function statusLabel(status: string): string {
  const upper = status.trim().toUpperCase();
  if (upper === 'CONFIRMED' || upper === 'COMPLETED' || upper === 'SUCCESS') return 'CONFIRMED';
  if (upper === 'PENDING') return 'PENDING';
  if (upper === 'CANCELLED' || upper === 'CANCELED' || upper === 'REJECTED') return 'CANCELLED';
  return upper || 'CONFIRMED';
}

export async function getPaymentSuccess(input: {
  userId: string;
  bookingId?: string;
  paymentId?: string;
}): Promise<PaymentSuccessResponse> {
  const userId = input.userId;

  const booking =
    input.bookingId && input.bookingId.trim()
      ? await Booking.findOne({ _id: input.bookingId.trim(), user_id: userId }).lean()
      : await Booking.findOne({ user_id: userId }).sort({ created_at: -1, _id: -1 }).lean();

  if (!booking) {
    throw new PaymentSuccessError(404, 'No booking found');
  }

  const bookingId = String(booking._id);
  const [items, user, payment] = await Promise.all([
    BookingItem.find({ booking_id: bookingId }).sort({ created_at: 1, _id: 1 }).lean(),
    User.findById(userId).lean(),
    input.paymentId
      ? Payment.findOne({ _id: input.paymentId, booking_id: bookingId }).lean()
      : Payment.findOne({ booking_id: bookingId }).sort({ created_at: -1, _id: -1 }).lean(),
  ]);

  const roomIds = firstNumber(items.map((item) => item.room_id));
  const flightIds = firstNumber(items.map((item) => item.flight_id));
  const activityIds = firstNumber(items.map((item) => item.activity_id));
  const rooms = await Room.find({ _id: { $in: roomIds } })
    .select({ _id: 1, hotel_id: 1, room_type: 1, image: 1 })
    .lean();
  const hotels = await Hotel.find({
    _id: { $in: firstNumber(rooms.map((room) => room.hotel_id)) },
    deleted_at: null,
  })
    .select({ _id: 1, name: 1, address: 1, image: 1, images: 1 })
    .lean();
  const flights = await Flight.find({ _id: { $in: flightIds }, deleted_at: null })
    .select({
      _id: 1,
      flight_number: 1,
      departure_airport: 1,
      arrival_airport: 1,
      image: 1,
    })
    .lean();
  const airports = await Airport.find({
    _id: {
      $in: firstString(flights.flatMap((f) => [f.departure_airport, f.arrival_airport])),
    },
  })
    .select({ _id: 1, name: 1 })
    .lean();
  const activities = await Activity.find({ _id: { $in: activityIds }, deleted_at: null })
    .select({ _id: 1, title: 1, image: 1, type: 1 })
    .lean();

  const roomMap = new Map(rooms.map((x) => [x._id, x] as const));
  const hotelMap = new Map(hotels.map((x) => [x._id, x] as const));
  const flightMap = new Map(flights.map((x) => [x._id, x] as const));
  const airportMap = new Map(airports.map((x) => [x._id, x] as const));
  const activityMap = new Map(activities.map((x) => [x._id, x] as const));

  const mappedItems: PaymentSuccessItem[] = items.map((item) => {
    const type = normalizeServiceType(item);
    const amount =
      typeof item.total_price === 'number' && Number.isFinite(item.total_price)
        ? item.total_price
        : 0;

    if (type === 'hotel') {
      const room = item.room_id != null ? roomMap.get(item.room_id) : undefined;
      const hotel = room ? hotelMap.get(room.hotel_id) : undefined;
      return {
        id: item._id,
        serviceType: 'hotel',
        title: hotel?.name ?? 'Hotel booking',
        subtitle: room?.room_type ?? null,
        startDate: item.start_date ?? null,
        endDate: item.end_date ?? null,
        dateLabel: dateRange(item.start_date, item.end_date),
        guests: item.quantity ?? null,
        ticketCode: item.e_ticket_code ?? '',
        imageUrl: imageOf(room?.image, hotel?.images?.[0], hotel?.image),
        amount,
        displayAmount: formatCurrency(amount),
      };
    }

    if (type === 'flight') {
      const flight = item.flight_id != null ? flightMap.get(item.flight_id) : undefined;
      const dep = flight ? airportMap.get(flight.departure_airport) : undefined;
      const arr = flight ? airportMap.get(flight.arrival_airport) : undefined;
      return {
        id: item._id,
        serviceType: 'flight',
        title: flight?.flight_number ? `Flight ${flight.flight_number}` : 'Flight booking',
        subtitle: flight
          ? `${dep?._id ?? flight.departure_airport} → ${arr?._id ?? flight.arrival_airport}`
          : null,
        startDate: item.start_date ?? null,
        endDate: item.end_date ?? null,
        dateLabel: dateRange(item.start_date, item.end_date),
        guests: item.quantity ?? null,
        ticketCode: item.e_ticket_code ?? '',
        imageUrl: imageOf(flight?.image),
        amount,
        displayAmount: formatCurrency(amount),
      };
    }

    const activity = item.activity_id != null ? activityMap.get(item.activity_id) : undefined;
    return {
      id: item._id,
      serviceType: 'activity',
      title: activity?.title ?? 'Activity booking',
      subtitle: activity?.type ?? null,
      startDate: item.start_date ?? null,
      endDate: item.end_date ?? null,
      dateLabel: dateRange(item.start_date, item.end_date),
      guests: item.quantity ?? null,
      ticketCode: item.e_ticket_code ?? '',
      imageUrl: imageOf(activity?.image),
      amount,
      displayAmount: formatCurrency(amount),
    };
  });

  const first = mappedItems[0];
  const destination = first?.title ?? 'Tripwise booking';
  const destinationSubtitle = first?.subtitle ?? null;
  const arrivalDate = first?.startDate ?? null;
  const firstItemStatus = items.find((item) => item.item_status)?.item_status;
  const bookingStatus = statusLabel(
    (firstItemStatus as string | undefined) ??
      (booking.status as string | undefined) ??
      (payment?.status as string | undefined) ??
      'CONFIRMED',
  );
  const amount =
    (typeof booking.final_amount === 'number' ? booking.final_amount : null) ??
    (typeof booking.total_amount === 'number' ? booking.total_amount : null) ??
    (typeof payment?.amount === 'number' ? payment.amount : 0);

  return {
    bookingId,
    bookingCode: bookingId.slice(0, 12).toUpperCase(),
    destination,
    destinationSubtitle,
    arrivalDate,
    arrivalDateLabel: formatDate(arrivalDate) ?? 'Date not set',
    imageUrl: first?.imageUrl ?? DEFAULT_IMAGE,
    status: bookingStatus,
    statusLabel: bookingStatus,
    message:
      bookingStatus === 'PENDING'
        ? 'Your booking has been received and is being confirmed.'
        : 'Your trip has been confirmed. E-ticket has been sent to your email.',
    emailSentTo: user?.email ?? null,
    amount,
    displayAmount: formatCurrency(amount),
    currency: 'USD',
    payment: {
      id: payment?._id ?? null,
      method: payment?.payment_method ?? null,
      status: payment?.status ?? null,
      transactionId: payment?.transaction_id ?? null,
      paidAt: payment?.created_at ?? null,
    },
    ticket: {
      code: first?.ticketCode ?? '',
      downloadUrl: '',
    },
    items: mappedItems,
  };
}
