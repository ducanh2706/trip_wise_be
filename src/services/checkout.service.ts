import { randomUUID } from 'crypto';
import { env } from '@/config/env';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Payment } from '@/models/Payment.model';
import { Room } from '@/models/Room.model';
import { User } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { createNotification } from '@/services/notifications.service';

export class CheckoutError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ActiveListing {
  hotelId: number;
  roomId: number;
  hotelName: string;
  roomType: string;
  providerId: string;
  imageUrl: string | null;
  basePrice: number;
}

export interface CheckoutSummaryResponse {
  listing: {
    hotelId: number;
    roomId: number;
    title: string;
    subtitle: string;
    imageUrl: string | null;
    startDate: string;
    endDate: string;
    nights: number;
    guests: number;
  };
  pricing: {
    currency: string;
    subtotal: number;
    taxes: number;
    fees: number;
    total: number;
    subtotalLabel: string;
    taxesLabel: string;
    feesLabel: string;
    totalLabel: string;
  };
  guestPrefill: {
    fullName: string;
    email: string | null;
    phone: string | null;
  };
  paymentOptions: Array<{
    key: 'card' | 'wallet' | 'paypal';
    title: string;
    subtitle: string;
  }>;
}

export interface CheckoutCompleteResponse {
  bookingId: string;
  paymentId: string;
  nextRoute: string;
  statusLabel: string;
  message: string;
}

function formatCurrency(value: number): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Math.round(value));
  } catch {
    return `$${Math.round(value).toLocaleString('en-US')}`;
  }
}

function toIsoDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDateOnly(raw?: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return toIsoDateOnly(d);
}

function defaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return toIsoDateOnly(d);
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return toIsoDateOnly(d);
}

function nightsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00.000Z`).getTime();
  const e = new Date(`${end}T00:00:00.000Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 1;
  return Math.max(1, Math.round((e - s) / 86_400_000));
}

function ticketCode(): string {
  return `TW-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function resolveListing(hotelIdInput?: unknown, roomIdInput?: unknown): Promise<ActiveListing> {
  const hotelId = Number(hotelIdInput);
  const roomId = Number(roomIdInput);

  let room =
    Number.isInteger(roomId) && roomId > 0
      ? await Room.findOne({ _id: roomId, deleted_at: null }).lean()
      : null;
  let hotel =
    Number.isInteger(hotelId) && hotelId > 0
      ? await Hotel.findOne({ _id: hotelId, deleted_at: null }).lean()
      : null;

  if (room && !hotel) {
    hotel = await Hotel.findOne({ _id: room.hotel_id, deleted_at: null }).lean();
  }
  if (hotel && !room) {
    room = await Room.findOne({ hotel_id: hotel._id, deleted_at: null })
      .sort({ base_price: 1, _id: 1 })
      .lean();
  }
  if (!hotel || !room) {
    const fallbackRoom = await Room.findOne({ deleted_at: null })
      .sort({ base_price: 1, _id: 1 })
      .lean();
    if (!fallbackRoom) throw new CheckoutError(404, 'No listings available');
    const fallbackHotel = await Hotel.findOne({
      _id: fallbackRoom.hotel_id,
      deleted_at: null,
    }).lean();
    if (!fallbackHotel) throw new CheckoutError(404, 'No listings available');
    hotel = fallbackHotel;
    room = fallbackRoom;
  }

  return {
    hotelId: hotel._id,
    roomId: room._id,
    hotelName: hotel.name,
    roomType: room.room_type ?? 'Room',
    providerId: hotel.provider_id,
    imageUrl:
      (room.image && room.image.length > 0 ? room.image : null) ??
      (hotel.images && hotel.images.length > 0 ? hotel.images[0] : null) ??
      hotel.image ??
      null,
    basePrice: room.base_price ?? 0,
  };
}

function pricing(basePrice: number, nights: number) {
  const subtotal = Math.round(basePrice * nights);
  const taxes = Math.round(subtotal * 0.08);
  const fees = Math.round(subtotal * 0.02);
  const total = subtotal + taxes + fees;
  return {
    subtotal,
    taxes,
    fees,
    total,
    subtotalLabel: formatCurrency(subtotal),
    taxesLabel: formatCurrency(taxes),
    feesLabel: formatCurrency(fees),
    totalLabel: formatCurrency(total),
  };
}

export async function getCheckoutSummary(input: {
  hotelId?: unknown;
  roomId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
}): Promise<CheckoutSummaryResponse> {
  const [listing, user, wallet] = await Promise.all([
    resolveListing(input.hotelId, input.roomId),
    User.findById(env.demoUserId).lean(),
    Wallet.findOne({ user_id: env.demoUserId }).lean(),
  ]);

  const startDate = parseDateOnly(input.startDate) ?? defaultStartDate();
  const endDate = parseDateOnly(input.endDate) ?? addDays(startDate, 2);
  const nights = nightsBetween(startDate, endDate);
  const guests = Math.max(1, Number(input.guests) || 2);
  const bill = pricing(listing.basePrice, nights);

  return {
    listing: {
      hotelId: listing.hotelId,
      roomId: listing.roomId,
      title: listing.hotelName,
      subtitle: listing.roomType,
      imageUrl: listing.imageUrl,
      startDate,
      endDate,
      nights,
      guests,
    },
    pricing: {
      currency: 'USD',
      ...bill,
    },
    guestPrefill: {
      fullName: user?.full_name?.trim() || 'Tripwise Traveler',
      email: user?.email ?? null,
      phone: user?.phone ?? null,
    },
    paymentOptions: [
      {
        key: 'card',
        title: 'Credit/Debit Card',
        subtitle: 'Visa, Mastercard, American Express',
      },
      {
        key: 'wallet',
        title: 'Tripwise Wallet',
        subtitle: `Balance: ${formatCurrency(wallet?.balance ?? 0)}`,
      },
      {
        key: 'paypal',
        title: 'PayPal',
        subtitle: 'Quick and secure',
      },
    ],
  };
}

export async function completeCheckout(input: {
  hotelId?: unknown;
  roomId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
  paymentMethod?: unknown;
  agreeToTerms?: unknown;
}): Promise<CheckoutCompleteResponse> {
  if (input.agreeToTerms !== true) {
    throw new CheckoutError(400, 'Please agree to booking terms to continue');
  }

  const listing = await resolveListing(input.hotelId, input.roomId);
  const startDate = parseDateOnly(input.startDate) ?? defaultStartDate();
  const endDate = parseDateOnly(input.endDate) ?? addDays(startDate, 2);
  const nights = nightsBetween(startDate, endDate);
  const guests = Math.max(1, Number(input.guests) || 2);
  const paymentMethod =
    typeof input.paymentMethod === 'string' ? input.paymentMethod.toLowerCase() : 'card';
  const paymentMethodDb =
    paymentMethod === 'wallet'
      ? 'WALLET'
      : paymentMethod === 'paypal'
        ? 'PAYPAL'
        : 'CREDIT_CARD';
  const bill = pricing(listing.basePrice, nights);
  const now = new Date().toISOString();

  const bookingId = randomUUID();
  const bookingItemId = randomUUID();
  const paymentId = randomUUID();

  await Promise.all([
    Booking.create({
      _id: bookingId,
      user_id: env.demoUserId,
      total_price: bill.subtotal,
      total_amount: bill.subtotal + bill.taxes + bill.fees,
      discount_amount: 0,
      final_amount: bill.total,
      currency: 'USD',
      status: 'CONFIRMED',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }),
    BookingItem.create({
      _id: bookingItemId,
      booking_id: bookingId,
      provider_id: listing.providerId,
      room_id: listing.roomId,
      flight_id: null,
      activity_id: null,
      start_date: startDate,
      end_date: endDate,
      quantity: guests,
      price_per_unit: listing.basePrice,
      total_price: bill.total,
      item_status: 'CONFIRMED',
      e_ticket_code: ticketCode(),
      created_at: now,
      updated_at: now,
    }),
    Payment.create({
      _id: paymentId,
      booking_id: bookingId,
      user_id: env.demoUserId,
      payment_method: paymentMethodDb,
      amount: bill.total,
      transaction_id: `TX-${Date.now()}`,
      status: 'SUCCESS',
      created_at: now,
      updated_at: now,
    }),
  ]);

  await createNotification({
    userId: env.demoUserId,
    type: 'BOOKING',
    title: 'Booking confirmed',
    body: `${listing.hotelName} has been booked successfully.`,
    actionRoute: `/payment_success?bookingId=${bookingId}&paymentId=${paymentId}`,
  });

  return {
    bookingId,
    paymentId,
    nextRoute: `/payment_success?bookingId=${bookingId}&paymentId=${paymentId}`,
    statusLabel: 'CONFIRMED',
    message: 'Booking completed successfully.',
  };
}
