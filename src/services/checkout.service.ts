import { randomUUID } from 'crypto';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Activity } from '@/models/Activity.model';
import { Airport } from '@/models/Airport.model';
import { Flight } from '@/models/Flight.model';
import { Hotel } from '@/models/Hotel.model';
import { Payment } from '@/models/Payment.model';
import { Provider } from '@/models/Provider.model';
import { Room } from '@/models/Room.model';
import { User } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { WalletTx } from '@/models/WalletTransaction.model';
import { createNotification } from '@/services/notifications.service';
import { env } from '@/config/env';
import { calculateCommission, creditWallet, ensureWallet } from '@/services/walletLedger.service';
import { calculateCompletedPoints } from '@/services/wallet.service';
import {
  createPayOSPaymentLink,
  getPayOSPaymentLinkStatus,
  isPayOSEnabled,
} from '@/services/payos.service';

export class CheckoutError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

interface ActiveListing {
  serviceType: 'hotel' | 'flight' | 'activity';
  hotelId: number;
  roomId: number;
  flightId: number | null;
  activityId: number | null;
  hotelName: string;
  roomType: string;
  providerId: string;
  imageUrl: string | null;
  basePrice: number;
  startDate: string | null;
  endDate: string | null;
  dateLocked: boolean;
  quantityTitle: string;
  unitTitle: string;
  flightNumber: string | null;
  airlineName: string | null;
  departureAirportCode: string | null;
  departureAirportName: string | null;
  arrivalAirportCode: string | null;
  arrivalAirportName: string | null;
  availableSeats: number | null;
}

export interface CheckoutSummaryResponse {
  listing: {
    hotelId: number;
    roomId: number;
    flightId: number | null;
    activityId: number | null;
    serviceType: 'hotel' | 'flight' | 'activity';
    title: string;
    subtitle: string;
    imageUrl: string | null;
    startDate: string;
    endDate: string;
    nights: number;
    guests: number;
    dateLocked: boolean;
    quantityTitle: string;
    unitTitle: string;
    flightNumber: string | null;
    airlineName: string | null;
    departureAirportCode: string | null;
    departureAirportName: string | null;
    arrivalAirportCode: string | null;
    arrivalAirportName: string | null;
    availableSeats: number | null;
    cabinClass: 'economy' | 'business';
    cabinClassLabel: string;
  };
  pricing: {
    currency: string;
    subtotal: number;
    taxes: number;
    fees: number;
    pointsAvailable: number;
    pointsMaxRedeem: number;
    pointsMaxRedeemLabel: string;
    total: number;
    subtotalLabel: string;
    taxesLabel: string;
    feesLabel: string;
    pointsAvailableLabel: string;
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
  payos?: {
    paymentLinkId: string;
    orderCode: number;
    checkoutUrl: string;
    qrCode: string;
    status: string;
    expiresAt: number;
  };
}

export interface CheckoutPayOSSessionResponse {
  bookingId: string;
  paymentId: string;
  status: string;
  amount: number;
  paymentLinkId: string;
  orderCode: number;
  checkoutUrl: string;
  qrCode: string;
  expiresAt: number | null;
}

export interface CheckoutPayOSConfirmResponse {
  bookingId: string;
  paymentId: string;
  paymentStatus: string;
  bookingStatus: string;
  nextRoute: string;
  isPaid: boolean;
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

function hasInputValue(raw: unknown): boolean {
  return typeof raw === 'string' ? raw.trim().length > 0 : raw != null;
}

function normalizeServiceType(value: unknown): 'hotel' | 'flight' | 'activity' {
  if (typeof value !== 'string') return 'hotel';
  const normalized = value.trim().toLowerCase();
  if (normalized === 'flight' || normalized === 'flights') return 'flight';
  if (normalized === 'tour' || normalized === 'tours' || normalized === 'activity') {
    return 'activity';
  }
  return 'hotel';
}

function normalizeCabinClass(value: unknown): 'economy' | 'business' {
  if (typeof value !== 'string') return 'economy';
  return value.trim().toLowerCase() === 'business' ? 'business' : 'economy';
}

function cabinClassLabel(value: 'economy' | 'business'): string {
  return value === 'business' ? 'Business' : 'Economy';
}

function cabinMultiplier(value: 'economy' | 'business'): number {
  return value === 'business' ? 1.8 : 1;
}

function airlineNameFromFlightNumber(value?: string | null): string {
  const prefix = (value ?? '').trim().match(/^[A-Z]+/)?.[0] ?? '';
  switch (prefix) {
    case 'VN':
      return 'Vietnam Airlines';
    case 'VJ':
      return 'VietJet Air';
    case 'QH':
      return 'Bamboo Airways';
    default:
      return prefix ? `${prefix} Air` : 'Tripwise Air';
  }
}

function generateSeatNumbers(count: number, cabinClass: 'economy' | 'business'): string[] {
  const seats: string[] = [];
  const letters = cabinClass === 'business' ? ['A', 'C', 'D', 'F'] : ['A', 'B', 'C', 'D', 'E', 'F'];
  const startRow = cabinClass === 'business' ? 1 : 12;
  let cursor = Math.floor(Math.random() * letters.length);

  for (let i = 0; i < count; i++) {
    const row = startRow + Math.floor((cursor + i) / letters.length);
    const letter = letters[(cursor + i) % letters.length];
    seats.push(`${row}${letter}`);
  }

  return seats;
}

function nightsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00.000Z`).getTime();
  const e = new Date(`${end}T00:00:00.000Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 1;
  return Math.max(1, Math.round((e - s) / 86_400_000));
}

function resolveBookingDetails(input: {
  serviceType?: 'hotel' | 'flight' | 'activity';
  lockedStartDate?: string | null;
  lockedEndDate?: string | null;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
}): {
  startDate: string;
  endDate: string;
  nights: number;
  guests: number;
} {
  if (input.serviceType === 'flight') {
    const startDate = parseDateOnly(input.lockedStartDate) ?? defaultStartDate();
    const endDate = parseDateOnly(input.lockedEndDate) ?? startDate;
    const travelerCount = Number(input.guests);
    if (hasInputValue(input.guests) && (!Number.isFinite(travelerCount) || travelerCount < 1)) {
      throw new CheckoutError(400, 'At least 1 traveler is required');
    }
    return {
      startDate,
      endDate,
      nights: 0,
      guests: Math.max(1, Math.floor(travelerCount || 1)),
    };
  }

  if (input.serviceType === 'activity') {
    const startDate = parseDateOnly(input.startDate) ?? defaultStartDate();
    const endDate = parseDateOnly(input.endDate) ?? startDate;
    const today = toIsoDateOnly(new Date());
    if (startDate < today) {
      throw new CheckoutError(400, 'Tour date cannot be in the past');
    }
    const peopleCount = Number(input.guests);
    if (hasInputValue(input.guests) && (!Number.isFinite(peopleCount) || peopleCount < 1)) {
      throw new CheckoutError(400, 'At least 1 person is required');
    }
    return {
      startDate,
      endDate,
      nights: 0,
      guests: Math.max(1, Math.floor(peopleCount || 1)),
    };
  }

  const startDate = parseDateOnly(input.startDate);
  const endDate = parseDateOnly(input.endDate);
  if (hasInputValue(input.startDate) && !startDate) {
    throw new CheckoutError(400, 'Please choose valid booking dates');
  }
  if (hasInputValue(input.endDate) && !endDate) {
    throw new CheckoutError(400, 'Please choose valid booking dates');
  }

  const resolvedStartDate = startDate ?? defaultStartDate();
  const resolvedEndDate = endDate ?? addDays(resolvedStartDate, 2);
  const today = toIsoDateOnly(new Date());
  if (resolvedStartDate < today) {
    throw new CheckoutError(400, 'Start date cannot be in the past');
  }
  if (resolvedEndDate <= resolvedStartDate) {
    throw new CheckoutError(400, 'End date must be after start date');
  }

  const guestCount = Number(input.guests);
  if (hasInputValue(input.guests) && (!Number.isFinite(guestCount) || guestCount < 1)) {
    throw new CheckoutError(400, 'At least 1 guest is required');
  }

  return {
    startDate: resolvedStartDate,
    endDate: resolvedEndDate,
    nights: nightsBetween(resolvedStartDate, resolvedEndDate),
    guests: Math.max(1, Math.floor(guestCount || 2)),
  };
}

function ticketCode(): string {
  return `TW-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function resolveListing(
  serviceTypeInput?: unknown,
  hotelIdInput?: unknown,
  roomIdInput?: unknown,
  flightIdInput?: unknown,
  activityIdInput?: unknown,
): Promise<ActiveListing> {
  const serviceType = normalizeServiceType(serviceTypeInput);
  if (serviceType === 'flight') {
    const flightId = Number(flightIdInput);
    if (!Number.isInteger(flightId) || flightId <= 0) {
      throw new CheckoutError(400, 'Please select a flight to book');
    }
    const flight = await Flight.findOne({ _id: flightId, deleted_at: null }).lean();
    if (!flight) throw new CheckoutError(404, 'Flight not found');
    if (typeof flight.base_price !== 'number' || flight.base_price <= 0) {
      throw new CheckoutError(409, 'This flight is not available for booking yet');
    }
    const [departure, arrival] = await Promise.all([
      Airport.findById(flight.departure_airport).select({ _id: 1, name: 1 }).lean(),
      Airport.findById(flight.arrival_airport).select({ _id: 1, name: 1 }).lean(),
    ]);

    return {
      serviceType: 'flight',
      hotelId: 0,
      roomId: 0,
      flightId: flight._id,
      activityId: null,
      hotelName: `${departure?._id ?? flight.departure_airport} -> ${
        arrival?._id ?? flight.arrival_airport
      }`,
      roomType: `${flight.flight_number} • ${departure?.name ?? flight.departure_airport} to ${
        arrival?.name ?? flight.arrival_airport
      }`,
      providerId: flight.provider_id,
      imageUrl: flight.image ?? null,
      basePrice: flight.base_price ?? 0,
      startDate: flight.departure_time ?? null,
      endDate: flight.arrival_time ?? flight.departure_time ?? null,
      dateLocked: true,
      quantityTitle: 'Travelers',
      unitTitle: 'Price per ticket',
      flightNumber: flight.flight_number,
      airlineName: airlineNameFromFlightNumber(flight.flight_number),
      departureAirportCode: departure?._id ?? flight.departure_airport,
      departureAirportName: departure?.name ?? flight.departure_airport,
      arrivalAirportCode: arrival?._id ?? flight.arrival_airport,
      arrivalAirportName: arrival?.name ?? flight.arrival_airport,
      availableSeats: flight.available_seats ?? null,
    };
  }

  if (serviceType === 'activity') {
    const activityId = Number(activityIdInput);
    if (!Number.isInteger(activityId) || activityId <= 0) {
      throw new CheckoutError(400, 'Please select a tour to book');
    }
    const activity = await Activity.findOne({
      _id: activityId,
      deleted_at: null,
      status: 'LIVE',
    }).lean();
    if (!activity) throw new CheckoutError(404, 'Tour not found');
    if (typeof activity.base_price !== 'number' || activity.base_price <= 0) {
      throw new CheckoutError(409, 'This tour is not available for booking yet');
    }

    return {
      serviceType: 'activity',
      hotelId: 0,
      roomId: 0,
      flightId: null,
      activityId: activity._id,
      hotelName: activity.title,
      roomType: `${activity.category ?? activity.type ?? 'Tour'} experience`,
      providerId: activity.provider_id,
      imageUrl: activity.image ?? null,
      basePrice: activity.base_price ?? 0,
      startDate: null,
      endDate: null,
      dateLocked: false,
      quantityTitle: 'People',
      unitTitle: 'Price per person',
      flightNumber: null,
      airlineName: null,
      departureAirportCode: null,
      departureAirportName: null,
      arrivalAirportCode: null,
      arrivalAirportName: null,
      availableSeats: null,
    };
  }

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
    room = await Room.findOne({
      hotel_id: hotel._id,
      deleted_at: null,
      base_price: { $gt: 0 },
    })
      .sort({ base_price: 1, _id: 1 })
      .lean();
  }
  if (!hotel || !room) {
    const fallbackRoom = await Room.findOne({
      deleted_at: null,
      base_price: { $gt: 0 },
    })
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
  if (typeof room.base_price !== 'number' || room.base_price <= 0) {
    throw new CheckoutError(409, 'This hotel is not available for booking yet');
  }

  return {
    serviceType: 'hotel',
    hotelId: hotel._id,
    roomId: room._id,
    flightId: null,
    activityId: null,
    hotelName: hotel.name,
    roomType: room.room_type ?? 'Room',
    providerId: hotel.provider_id,
    imageUrl:
      (room.image && room.image.length > 0 ? room.image : null) ??
      (hotel.images && hotel.images.length > 0 ? hotel.images[0] : null) ??
      hotel.image ??
      null,
    basePrice: room.base_price ?? 0,
    startDate: null,
    endDate: null,
    dateLocked: false,
    quantityTitle: 'Guests',
    unitTitle: 'Price per night',
    flightNumber: null,
    airlineName: null,
    departureAirportCode: null,
    departureAirportName: null,
    arrivalAirportCode: null,
    arrivalAirportName: null,
    availableSeats: null,
  };
}

function pricing(basePrice: number, units: number) {
  const subtotal = Math.round(basePrice * units);
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

function maxRedeemablePoints(total: number, availablePoints: number): number {
  return Math.max(
    0,
    Math.min(Math.round(total * 0.2), Math.max(0, Math.round(availablePoints))),
  );
}

function createPayOSOrderCode(): number {
  const epochSeconds = Math.floor(Date.now() / 1000);
  const random = Math.floor(100 + Math.random() * 900);
  return Number(`${epochSeconds}${random}`);
}

function payOSAmountFromUsd(usdAmount: number): number {
  const approxVndRate = 25_000;
  return Math.max(1000, Math.round(usdAmount * approxVndRate));
}

function buildPayOSReturnUrl(bookingId: string, paymentId: string): string {
  const base = env.payosReturnUrl.trim();
  if (!base) {
    return `tripwise://payos/return?bookingId=${encodeURIComponent(bookingId)}&paymentId=${encodeURIComponent(paymentId)}`;
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}bookingId=${encodeURIComponent(bookingId)}&paymentId=${encodeURIComponent(paymentId)}`;
}

function buildPayOSCancelUrl(bookingId: string, paymentId: string): string {
  const base = env.payosCancelUrl.trim();
  if (!base) {
    return `tripwise://payos/cancel?bookingId=${encodeURIComponent(bookingId)}&paymentId=${encodeURIComponent(paymentId)}`;
  }
  const separator = base.includes('?') ? '&' : '?';
  return `${base}${separator}bookingId=${encodeURIComponent(bookingId)}&paymentId=${encodeURIComponent(paymentId)}`;
}

function asNumber(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

async function notifyProviderBookingPending(providerId: string, hotelName: string): Promise<void> {
  const provider = await Provider.findById(providerId)
    .select({ user_id: 1, business_name: 1 })
    .lean();
  const providerUserId = provider?.user_id || provider?._id;
  if (!providerUserId) return;
  await createNotification({
    userId: providerUserId,
    type: 'BOOKING',
    title: 'New booking request',
    body: `${hotelName} has a new booking awaiting your confirmation.`,
    actionRoute: '/order_manager',
  });
}

/** Money-aware detail for the booking-received notification, e.g.
 *  "$420 charged from your wallet · 200 points redeemed". Empty when there is
 *  nothing financial to report. */
function describeBookingCharge(
  amountDue: number,
  pointsDiscount: number,
  paymentMethod?: string,
): string {
  const parts: string[] = [];
  if (amountDue > 0) {
    const from = (paymentMethod ?? '').toUpperCase() === 'WALLET' ? ' from your wallet' : '';
    parts.push(`${formatCurrency(amountDue)} charged${from}`);
  }
  if (pointsDiscount > 0) {
    parts.push(`${pointsDiscount.toLocaleString('en-US')} points redeemed`);
  }
  return parts.join(' · ');
}

async function settleSuccessfulCheckoutPayment(input: {
  userId: string;
  bookingId: string;
  paymentId: string;
  providerId: string;
  bookingItemId: string;
  amountDue: number;
  pointsDiscount: number;
  hotelName: string;
  transactionId: string;
  paymentMethod?: string;
}): Promise<void> {
  const now = new Date().toISOString();

  await Promise.all([
    Payment.updateOne(
      { _id: input.paymentId, user_id: input.userId },
      {
        $set: {
          status: 'SUCCESS',
          transaction_id: input.transactionId,
          updated_at: now,
        },
      },
    ),
    Booking.updateOne(
      { _id: input.bookingId, user_id: input.userId },
      {
        $set: {
          status: 'PENDING',
          updated_at: now,
        },
      },
    ),
    BookingItem.updateOne(
      { _id: input.bookingItemId, booking_id: input.bookingId },
      {
        $set: {
          item_status: 'PENDING',
          escrow_status: 'HELD',
          updated_at: now,
        },
      },
    ),
  ]);

  if (input.pointsDiscount > 0) {
    const existingRedeem = await WalletTx.findOne({
      booking_id: input.bookingId,
      booking_item_id: input.bookingItemId,
      type: 'POINT_REDEEM',
    }).lean();

    if (!existingRedeem) {
      await WalletTx.create({
        _id: randomUUID(),
        user_id: input.userId,
        type: 'POINT_REDEEM',
        amount: input.pointsDiscount,
        card_id: 'points',
        card_last4: null,
        status: 'SUCCESS',
        booking_id: input.bookingId,
        booking_item_id: input.bookingItemId,
        provider_id: input.providerId,
        note: 'Points discount applied to booking',
        created_at: now,
      });

      const summary = await calculateCompletedPoints(input.userId);
      await Wallet.updateOne(
        { user_id: input.userId },
        {
          $set: {
            loyalty_points: Math.max(summary.points - input.pointsDiscount, 0),
            updated_at: now,
          },
        },
      );
    }
  }

  if (input.amountDue > 0) {
    const escrowExists = await WalletTx.findOne({
      booking_id: input.bookingId,
      booking_item_id: input.bookingItemId,
      type: 'BOOKING_ESCROW_IN',
    }).lean();

    if (!escrowExists) {
      await creditWallet({
        userId: env.adminWalletUserId,
        amount: input.amountDue,
        type: 'BOOKING_ESCROW_IN',
        status: 'HELD',
        bookingId: input.bookingId,
        bookingItemId: input.bookingItemId,
        providerId: input.providerId,
        note: `Escrow payment for ${input.hotelName}`,
      });
    }
  }

  const charge = describeBookingCharge(
    input.amountDue,
    input.pointsDiscount,
    input.paymentMethod,
  );
  await createNotification({
    userId: input.userId,
    type: 'BOOKING',
    title: 'Booking request received',
    body: charge
      ? `${input.hotelName} — ${charge}. Waiting for provider confirmation.`
      : `${input.hotelName} is waiting for provider confirmation.`,
    actionRoute: `/payment_success?bookingId=${input.bookingId}&paymentId=${input.paymentId}`,
  });

  await notifyProviderBookingPending(input.providerId, input.hotelName);
}

export async function getCheckoutSummary(input: {
  userId: string;
  serviceType?: unknown;
  hotelId?: unknown;
  roomId?: unknown;
  flightId?: unknown;
  activityId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
  cabinClass?: unknown;
}): Promise<CheckoutSummaryResponse> {
  const [listing, user, wallet, pointSummary] = await Promise.all([
    resolveListing(input.serviceType, input.hotelId, input.roomId, input.flightId, input.activityId),
    User.findById(input.userId).lean(),
    Wallet.findOne({ user_id: input.userId }).lean(),
    calculateCompletedPoints(input.userId),
  ]);

  const { startDate, endDate, nights, guests } = resolveBookingDetails({
    ...input,
    serviceType: listing.serviceType,
    lockedStartDate: listing.startDate,
    lockedEndDate: listing.endDate,
  });
  if (
    listing.serviceType === 'flight' &&
    listing.availableSeats != null &&
    guests > listing.availableSeats
  ) {
    throw new CheckoutError(400, `Only ${listing.availableSeats} seat(s) available`);
  }
  const cabinClass = normalizeCabinClass(input.cabinClass);
  const basePrice =
    listing.serviceType === 'flight'
      ? Math.round(listing.basePrice * cabinMultiplier(cabinClass))
      : listing.basePrice;
  const billableUnits = listing.serviceType === 'hotel' ? nights : guests;
  const bill = pricing(basePrice, billableUnits);
  const pointsMaxRedeem = maxRedeemablePoints(bill.total, pointSummary.points);

  return {
    listing: {
      hotelId: listing.hotelId,
      roomId: listing.roomId,
      flightId: listing.flightId,
      activityId: listing.activityId,
      serviceType: listing.serviceType,
      title: listing.hotelName,
      subtitle: listing.roomType,
      imageUrl: listing.imageUrl,
      startDate,
      endDate,
      nights,
      guests,
      dateLocked: listing.dateLocked,
      quantityTitle: listing.quantityTitle,
      unitTitle: listing.unitTitle,
      flightNumber: listing.flightNumber,
      airlineName: listing.airlineName,
      departureAirportCode: listing.departureAirportCode,
      departureAirportName: listing.departureAirportName,
      arrivalAirportCode: listing.arrivalAirportCode,
      arrivalAirportName: listing.arrivalAirportName,
      availableSeats: listing.availableSeats,
      cabinClass,
      cabinClassLabel: cabinClassLabel(cabinClass),
    },
    pricing: {
      currency: 'USD',
      ...bill,
      pointsAvailable: pointSummary.points,
      pointsMaxRedeem,
      pointsMaxRedeemLabel: formatCurrency(pointsMaxRedeem),
      pointsAvailableLabel: `${pointSummary.points.toLocaleString('en-US')} points`,
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
  userId: string;
  serviceType?: unknown;
  hotelId?: unknown;
  roomId?: unknown;
  flightId?: unknown;
  activityId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
  paymentMethod?: unknown;
  usePoints?: unknown;
  agreeToTerms?: unknown;
  cabinClass?: unknown;
}): Promise<CheckoutCompleteResponse> {
  if (input.agreeToTerms !== true) {
    throw new CheckoutError(400, 'Please agree to booking terms to continue');
  }

  const listing = await resolveListing(
    input.serviceType,
    input.hotelId,
    input.roomId,
    input.flightId,
    input.activityId,
  );
  const { startDate, endDate, nights, guests } = resolveBookingDetails({
    ...input,
    serviceType: listing.serviceType,
    lockedStartDate: listing.startDate,
    lockedEndDate: listing.endDate,
  });
  const paymentMethod =
    typeof input.paymentMethod === 'string' ? input.paymentMethod.toLowerCase() : 'card';
  const paymentMethodDb =
    paymentMethod === 'wallet' ? 'WALLET' : paymentMethod === 'paypal' ? 'PAYPAL' : 'CREDIT_CARD';
  if (
    listing.serviceType === 'flight' &&
    listing.availableSeats != null &&
    guests > listing.availableSeats
  ) {
    throw new CheckoutError(400, `Only ${listing.availableSeats} seat(s) available`);
  }
  const cabinClass = normalizeCabinClass(input.cabinClass);
  const basePrice =
    listing.serviceType === 'flight'
      ? Math.round(listing.basePrice * cabinMultiplier(cabinClass))
      : listing.basePrice;
  const billableUnits = listing.serviceType === 'hotel' ? nights : guests;
  const bill = pricing(basePrice, billableUnits);
  const pointSummary = await calculateCompletedPoints(input.userId);
  const pointsDiscount =
    input.usePoints === true ? maxRedeemablePoints(bill.total, pointSummary.points) : 0;
  const amountDue = Math.max(bill.total - pointsDiscount, 0);
  const now = new Date().toISOString();
  const settlement = calculateCommission(amountDue);

  const bookingId = randomUUID();
  const bookingItemId = randomUUID();
  const paymentId = randomUUID();
  const payosOrderCode = paymentMethodDb === 'WALLET' ? null : createPayOSOrderCode();

  if (paymentMethodDb === 'WALLET') {
    await ensureWallet(input.userId);
    const wallet = await Wallet.findOne({ user_id: input.userId });
    if (!wallet || (wallet.balance ?? 0) < amountDue) {
      throw new CheckoutError(400, 'Wallet has insufficient funds');
    }
    wallet.balance = (wallet.balance ?? 0) - amountDue;
    wallet.updated_at = now;
    await wallet.save();
  }

  await Promise.all([
    Booking.create({
      _id: bookingId,
      user_id: input.userId,
      total_price: bill.subtotal,
      total_amount: bill.subtotal + bill.taxes + bill.fees,
      discount_amount: pointsDiscount,
      final_amount: amountDue,
      currency: 'USD',
      status: paymentMethodDb === 'WALLET' ? 'PENDING' : 'PENDING_PAYMENT',
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }),
    BookingItem.create({
      _id: bookingItemId,
      booking_id: bookingId,
      provider_id: listing.providerId,
      room_id: listing.serviceType === 'hotel' ? listing.roomId : null,
      flight_id: listing.serviceType === 'flight' ? listing.flightId : null,
      activity_id: listing.serviceType === 'activity' ? listing.activityId : null,
      start_date: startDate,
      end_date: endDate,
      quantity: guests,
      price_per_unit: basePrice,
      total_price: amountDue,
      gross_amount: settlement.grossAmount,
      commission_rate: env.platformCommissionRate,
      commission_amount: settlement.commissionAmount,
      provider_net_amount: settlement.providerNetAmount,
      escrow_status: paymentMethodDb === 'WALLET' ? 'HELD' : 'NONE',
      payout_request_id: null,
      paid_to_provider_at: null,
      item_status: paymentMethodDb === 'WALLET' ? 'PENDING' : 'PENDING_PAYMENT',
      e_ticket_code: ticketCode(),
      cabin_class: listing.serviceType === 'flight' ? cabinClassLabel(cabinClass) : null,
      seat_numbers:
        listing.serviceType === 'flight' ? generateSeatNumbers(guests, cabinClass) : undefined,
      airline_name: listing.serviceType === 'flight' ? listing.airlineName : null,
      created_at: now,
      updated_at: now,
    }),
    Payment.create({
      _id: paymentId,
      booking_id: bookingId,
      user_id: input.userId,
      payment_method: paymentMethodDb,
      amount: amountDue,
      transaction_id: paymentMethodDb === 'WALLET' ? `TX-${Date.now()}` : null,
      status: paymentMethodDb === 'WALLET' ? 'SUCCESS' : 'PENDING',
      payos_order_code: payosOrderCode,
      created_at: now,
      updated_at: now,
    } as any),
  ]);

  if (listing.serviceType === 'flight' && listing.flightId != null) {
    await Flight.updateOne(
      { _id: listing.flightId, deleted_at: null },
      {
        $inc: { available_seats: -guests },
        $set: { updated_at: now },
      },
    );
  }

  if (paymentMethodDb === 'WALLET') {
    await settleSuccessfulCheckoutPayment({
      userId: input.userId,
      bookingId,
      paymentId,
      providerId: listing.providerId,
      bookingItemId,
      amountDue,
      pointsDiscount,
      hotelName: listing.hotelName,
      transactionId: `TX-${Date.now()}`,
      paymentMethod: 'WALLET',
    });

    return {
      bookingId,
      paymentId,
      nextRoute: `/payment_success?bookingId=${bookingId}&paymentId=${paymentId}`,
      statusLabel: 'PENDING',
      message: 'Booking request submitted. The provider will confirm it shortly.',
    };
  }

  if (!isPayOSEnabled()) {
    throw new CheckoutError(
      503,
      'PayOS is not configured yet. Please provide PAYOS_CLIENT_ID, PAYOS_API_KEY and PAYOS_CHECKSUM_KEY.',
    );
  }

  try {
    const paymentLink = await createPayOSPaymentLink({
      orderCode: payosOrderCode!,
      amount: payOSAmountFromUsd(amountDue),
      description: `TW-${bookingId.slice(0, 8)}`,
      itemName: `${listing.hotelName} - ${listing.roomType}`,
      quantity: guests,
      returnUrl: buildPayOSReturnUrl(bookingId, paymentId),
      cancelUrl: buildPayOSCancelUrl(bookingId, paymentId),
      buyerName: undefined,
      buyerEmail: undefined,
      buyerPhone: undefined,
    });

    await Payment.updateOne(
      { _id: paymentId, booking_id: bookingId },
      {
        $set: {
          payos_payment_link_id: paymentLink.paymentLinkId,
          payos_checkout_url: paymentLink.checkoutUrl,
          payos_qr_code: paymentLink.qrCode,
          payos_expired_at: paymentLink.expiredAt,
          payos_last_status: paymentLink.status,
          updated_at: new Date().toISOString(),
        },
      },
    );

    return {
      bookingId,
      paymentId,
      nextRoute: '/home',
      statusLabel: 'PENDING_PAYMENT',
      message: 'Please complete payment with PayOS within 5 minutes.',
      payos: {
        paymentLinkId: paymentLink.paymentLinkId,
        orderCode: paymentLink.orderCode,
        checkoutUrl: paymentLink.checkoutUrl,
        qrCode: paymentLink.qrCode,
        status: paymentLink.status,
        expiresAt: paymentLink.expiredAt,
      },
    };
  } catch (error) {
    await Promise.all([
      Payment.updateOne(
        { _id: paymentId, booking_id: bookingId },
        { $set: { status: 'FAILED', updated_at: new Date().toISOString() } },
      ),
      BookingItem.updateOne(
        { _id: bookingItemId, booking_id: bookingId },
        { $set: { item_status: 'FAILED', updated_at: new Date().toISOString() } },
      ),
      Booking.updateOne(
        { _id: bookingId, user_id: input.userId },
        { $set: { status: 'FAILED', updated_at: new Date().toISOString() } },
      ),
      listing.serviceType === 'flight' && listing.flightId != null
        ? Flight.updateOne(
            { _id: listing.flightId, deleted_at: null },
            {
              $inc: { available_seats: guests },
              $set: { updated_at: new Date().toISOString() },
            },
          )
        : Promise.resolve(),
    ]);
    const message = error instanceof Error ? error.message : 'Could not create PayOS payment link';
    throw new CheckoutError(502, message);
  }
}

export async function getCheckoutPayOSSession(input: {
  userId: string;
  bookingId?: unknown;
  paymentId?: unknown;
}): Promise<CheckoutPayOSSessionResponse> {
  const bookingId = typeof input.bookingId === 'string' ? input.bookingId.trim() : '';
  if (!bookingId) throw new CheckoutError(400, 'Missing bookingId');

  const booking = await Booking.findOne({ _id: bookingId, user_id: input.userId }).lean();
  if (!booking) throw new CheckoutError(404, 'Booking not found');

  const payment = await Payment.findOne({
    booking_id: bookingId,
    ...(typeof input.paymentId === 'string' && input.paymentId.trim()
      ? { _id: input.paymentId.trim() }
      : {}),
  })
    .sort({ created_at: -1, _id: -1 })
    .lean();

  if (!payment) throw new CheckoutError(404, 'Payment not found');
  const paymentAny = payment as Record<string, unknown>;

  const paymentLinkId =
    typeof paymentAny.payos_payment_link_id === 'string'
      ? paymentAny.payos_payment_link_id
      : '';
  const checkoutUrl =
    typeof paymentAny.payos_checkout_url === 'string' ? paymentAny.payos_checkout_url : '';
  const qrCode = typeof paymentAny.payos_qr_code === 'string' ? paymentAny.payos_qr_code : '';
  const orderCode = asNumber(paymentAny.payos_order_code);
  const expiresAt = asNumber(paymentAny.payos_expired_at);

  if (!paymentLinkId || !checkoutUrl || !qrCode || orderCode == null) {
    throw new CheckoutError(409, 'This booking does not have a PayOS payment session');
  }

  return {
    bookingId,
    paymentId: String(payment._id),
    status: String(payment.status ?? 'PENDING'),
    amount: typeof payment.amount === 'number' ? payment.amount : 0,
    paymentLinkId,
    orderCode,
    checkoutUrl,
    qrCode,
    expiresAt,
  };
}

export async function confirmCheckoutPayOSPayment(input: {
  userId: string;
  bookingId?: unknown;
}): Promise<CheckoutPayOSConfirmResponse> {
  const bookingId = typeof input.bookingId === 'string' ? input.bookingId.trim() : '';
  if (!bookingId) throw new CheckoutError(400, 'Missing bookingId');

  const booking = await Booking.findOne({ _id: bookingId, user_id: input.userId }).lean();
  if (!booking) throw new CheckoutError(404, 'Booking not found');

  const [payment, bookingItem] = await Promise.all([
    Payment.findOne({ booking_id: bookingId }).sort({ created_at: -1, _id: -1 }).lean(),
    BookingItem.findOne({ booking_id: bookingId }).sort({ created_at: 1, _id: 1 }).lean(),
  ]);
  if (!payment || !bookingItem) throw new CheckoutError(404, 'Booking payment not found');
  const paymentAny = payment as Record<string, unknown>;

  const paymentId = String(payment._id);
  if (String(payment.status ?? '').toUpperCase() === 'SUCCESS') {
    return {
      bookingId,
      paymentId,
      paymentStatus: 'SUCCESS',
      bookingStatus: String(booking.status ?? 'PENDING'),
      nextRoute: `/my_trips?status=upcoming&bookingId=${encodeURIComponent(bookingId)}`,
      isPaid: true,
      message: 'Payment has already been confirmed.',
    };
  }

  const paymentLinkId =
    typeof paymentAny.payos_payment_link_id === 'string'
      ? paymentAny.payos_payment_link_id
      : '';
  const orderCode = asNumber(paymentAny.payos_order_code);
  if (!paymentLinkId && orderCode == null) {
    throw new CheckoutError(409, 'Missing PayOS payment link information');
  }

  let status = 'PENDING';
  let transactionId = typeof payment.transaction_id === 'string' ? payment.transaction_id : '';
  try {
    const link = await getPayOSPaymentLinkStatus(paymentLinkId || orderCode!);
    status = link.status;
    transactionId = link.transactions?.[0]?.reference || transactionId;
    await Payment.updateOne(
      { _id: paymentId },
      {
        $set: {
          payos_last_status: status,
          updated_at: new Date().toISOString(),
        },
      },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not verify PayOS payment';
    throw new CheckoutError(502, message);
  }

  if (status !== 'PAID') {
    return {
      bookingId,
      paymentId,
      paymentStatus: status,
      bookingStatus: String(booking.status ?? 'PENDING_PAYMENT'),
      nextRoute: '/home',
      isPaid: false,
      message: status === 'EXPIRED'
        ? 'QR payment expired. Please create a new booking.'
        : 'Payment has not completed yet.',
    };
  }

  const room = bookingItem.room_id
    ? await Room.findOne({ _id: bookingItem.room_id }).select({ hotel_id: 1 }).lean()
    : null;
  const hotelName = room?.hotel_id
    ? await Hotel.findOne({ _id: room.hotel_id })
        .select({ name: 1 })
        .lean()
        .then((h) => h?.name ?? 'your booking')
    : 'your booking';

  await settleSuccessfulCheckoutPayment({
    userId: input.userId,
    bookingId,
    paymentId,
    providerId: String(bookingItem.provider_id),
    bookingItemId: String(bookingItem._id),
    amountDue: typeof payment.amount === 'number' ? payment.amount : 0,
    pointsDiscount:
      typeof booking.discount_amount === 'number' ? Math.max(0, booking.discount_amount) : 0,
    hotelName,
    transactionId: transactionId || `PAYOS-${Date.now()}`,
    paymentMethod: 'PAYOS',
  });

  return {
    bookingId,
    paymentId,
    paymentStatus: 'SUCCESS',
    bookingStatus: 'PENDING',
    nextRoute: `/my_trips?status=upcoming&bookingId=${encodeURIComponent(bookingId)}`,
    isPaid: true,
    message: 'Payment confirmed successfully.',
  };
}
