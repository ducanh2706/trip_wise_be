import { randomUUID } from 'crypto';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
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

function nightsBetween(start: string, end: string): number {
  const s = new Date(`${start}T00:00:00.000Z`).getTime();
  const e = new Date(`${end}T00:00:00.000Z`).getTime();
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return 1;
  return Math.max(1, Math.round((e - s) / 86_400_000));
}

function resolveBookingDetails(input: {
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
}): {
  startDate: string;
  endDate: string;
  nights: number;
  guests: number;
} {
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
  hotelIdInput?: unknown,
  roomIdInput?: unknown,
): Promise<ActiveListing> {
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

function maxRedeemablePoints(total: number, availablePoints: number): number {
  return Math.max(
    0,
    Math.min(Math.round(total * 0.2), Math.max(0, Math.round(availablePoints))),
  );
}

export async function getCheckoutSummary(input: {
  userId: string;
  hotelId?: unknown;
  roomId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
}): Promise<CheckoutSummaryResponse> {
  const [listing, user, wallet, pointSummary] = await Promise.all([
    resolveListing(input.hotelId, input.roomId),
    User.findById(input.userId).lean(),
    Wallet.findOne({ user_id: input.userId }).lean(),
    calculateCompletedPoints(input.userId),
  ]);

  const { startDate, endDate, nights, guests } = resolveBookingDetails(input);
  const bill = pricing(listing.basePrice, nights);
  const pointsMaxRedeem = maxRedeemablePoints(bill.total, pointSummary.points);

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
  hotelId?: unknown;
  roomId?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  guests?: unknown;
  paymentMethod?: unknown;
  usePoints?: unknown;
  agreeToTerms?: unknown;
}): Promise<CheckoutCompleteResponse> {
  if (input.agreeToTerms !== true) {
    throw new CheckoutError(400, 'Please agree to booking terms to continue');
  }

  const listing = await resolveListing(input.hotelId, input.roomId);
  const { startDate, endDate, nights, guests } = resolveBookingDetails(input);
  const paymentMethod =
    typeof input.paymentMethod === 'string' ? input.paymentMethod.toLowerCase() : 'card';
  const paymentMethodDb =
    paymentMethod === 'wallet' ? 'WALLET' : paymentMethod === 'paypal' ? 'PAYPAL' : 'CREDIT_CARD';
  const bill = pricing(listing.basePrice, nights);
  const pointSummary = await calculateCompletedPoints(input.userId);
  const pointsDiscount =
    input.usePoints === true ? maxRedeemablePoints(bill.total, pointSummary.points) : 0;
  const amountDue = Math.max(bill.total - pointsDiscount, 0);
  const now = new Date().toISOString();
  const settlement = calculateCommission(amountDue);

  const bookingId = randomUUID();
  const bookingItemId = randomUUID();
  const paymentId = randomUUID();

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
      status: 'PENDING',
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
      total_price: amountDue,
      gross_amount: settlement.grossAmount,
      commission_rate: env.platformCommissionRate,
      commission_amount: settlement.commissionAmount,
      provider_net_amount: settlement.providerNetAmount,
      escrow_status: 'HELD',
      payout_request_id: null,
      paid_to_provider_at: null,
      item_status: 'PENDING',
      e_ticket_code: ticketCode(),
      created_at: now,
      updated_at: now,
    }),
    Payment.create({
      _id: paymentId,
      booking_id: bookingId,
      user_id: input.userId,
      payment_method: paymentMethodDb,
      amount: amountDue,
      transaction_id: `TX-${Date.now()}`,
      status: 'SUCCESS',
      created_at: now,
      updated_at: now,
    }),
  ]);

  if (pointsDiscount > 0) {
    await WalletTx.create({
      _id: randomUUID(),
      user_id: input.userId,
      type: 'POINT_REDEEM',
      amount: pointsDiscount,
      card_id: 'points',
      card_last4: null,
      status: 'SUCCESS',
      booking_id: bookingId,
      booking_item_id: bookingItemId,
      provider_id: listing.providerId,
      note: 'Points discount applied to booking',
      created_at: now,
    });
    await Wallet.updateOne(
      { user_id: input.userId },
      {
        $set: {
          loyalty_points: Math.max(pointSummary.points - pointsDiscount, 0),
          updated_at: now,
        },
      },
    );
  }

  await creditWallet({
    userId: env.adminWalletUserId,
    amount: amountDue,
    type: 'BOOKING_ESCROW_IN',
    status: 'HELD',
    bookingId,
    bookingItemId,
    providerId: listing.providerId,
    note: `Escrow payment for ${listing.hotelName}`,
  });

  await createNotification({
    userId: input.userId,
    type: 'BOOKING',
    title: 'Booking request received',
    body: `${listing.hotelName} is waiting for provider confirmation.`,
    actionRoute: `/payment_success?bookingId=${bookingId}&paymentId=${paymentId}`,
  });

  // Provider-side notification: the listing owner needs to act on this. The
  // Provider model's `user_id` is the account that gets pushed; fall back to
  // `_id` when that's missing (legacy providers were created with id === user
  // id — see adminPayouts.summarizeProvider for the same fallback).
  const provider = await Provider.findById(listing.providerId)
    .select({ user_id: 1, business_name: 1 })
    .lean();
  const providerUserId = provider?.user_id || provider?._id;
  if (providerUserId) {
    await createNotification({
      userId: providerUserId,
      type: 'BOOKING',
      title: 'New booking request',
      body: `${listing.hotelName} has a new booking awaiting your confirmation.`,
      actionRoute: '/order_manager',
    });
  }

  return {
    bookingId,
    paymentId,
    nextRoute: `/payment_success?bookingId=${bookingId}&paymentId=${paymentId}`,
    statusLabel: 'PENDING',
    message: 'Booking request submitted. The provider will confirm it shortly.',
  };
}
