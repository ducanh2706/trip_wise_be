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

  await createNotification({
    userId: input.userId,
    type: 'BOOKING',
    title: 'Booking request received',
    body: `${input.hotelName} is waiting for provider confirmation.`,
    actionRoute: `/payment_success?bookingId=${input.bookingId}&paymentId=${input.paymentId}`,
  });

  await notifyProviderBookingPending(input.providerId, input.hotelName);
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
      escrow_status: paymentMethodDb === 'WALLET' ? 'HELD' : 'NONE',
      payout_request_id: null,
      paid_to_provider_at: null,
      item_status: paymentMethodDb === 'WALLET' ? 'PENDING' : 'PENDING_PAYMENT',
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
      transaction_id: paymentMethodDb === 'WALLET' ? `TX-${Date.now()}` : null,
      status: paymentMethodDb === 'WALLET' ? 'SUCCESS' : 'PENDING',
      payos_order_code: payosOrderCode,
      created_at: now,
      updated_at: now,
    } as any),
  ]);

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
