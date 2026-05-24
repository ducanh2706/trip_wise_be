import { Booking, type BookingDoc } from '@/models/Booking.model';
import { BookingItem, type BookingItemDoc } from '@/models/BookingItem.model';
import { Hotel, type HotelDoc } from '@/models/Hotel.model';
import { Payment } from '@/models/Payment.model';
import { Provider, type ProviderDoc } from '@/models/Provider.model';
import { Room, type RoomDoc } from '@/models/Room.model';
import { User, type UserDoc } from '@/models/User.model';
import { Wallet } from '@/models/Wallet.model';
import { env } from '@/config/env';
import { createNotification } from '@/services/notifications.service';
import { creditWallet, debitWallet, ensureWallet } from '@/services/walletLedger.service';

type CancellationDecision = 'APPROVED' | 'REJECTED';
type LeanCancellationItem = BookingItemDoc;
type LeanBooking = Pick<BookingDoc, '_id' | 'user_id' | 'status'>;
type LeanUser = Pick<UserDoc, '_id' | 'full_name' | 'email'>;
type LeanProvider = Pick<ProviderDoc, '_id' | 'business_name' | 'user_id'>;
type LeanRoom = Pick<RoomDoc, '_id' | 'hotel_id' | 'room_type'>;
type LeanHotel = Pick<HotelDoc, '_id' | 'name' | 'address' | 'provider_id'>;

export interface AdminCancellationRequest {
  id: string;
  bookingId: string;
  userId: string;
  userName: string;
  userEmail: string | null;
  providerId: string;
  providerName: string;
  title: string;
  subtitle: string;
  dateLabel: string;
  requestedAt: string | null;
  cancelDeadline: string | null;
  amount: number;
  displayAmount: string;
}

export interface AdminCancellationRequestsResponse {
  pendingCount: number;
  totalRefundAmount: number;
  displayTotalRefundAmount: string;
  requests: AdminCancellationRequest[];
}

export interface AdminCancellationReviewResponse {
  bookingItemId: string;
  bookingId: string;
  status: 'CANCELLED' | 'REJECTED';
  refundAmount: number;
  displayRefundAmount: string;
  message: string;
}

export class AdminCancellationError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'REJECTED']);
const CANCELLATION_PENDING_STATUS = 'CANCELLATION_PENDING';
const CONFIRMED_STATUSES = new Set(['CONFIRMED', 'PAID', 'ACCEPTED', 'APPROVED']);

function normalizeDecision(value: unknown): CancellationDecision {
  const raw = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (raw === 'APPROVED' || raw === 'APPROVE') return 'APPROVED';
  if (raw === 'REJECTED' || raw === 'REJECT') return 'REJECTED';
  throw new AdminCancellationError(400, 'Decision must be APPROVED or REJECTED');
}

function normalizeStatus(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(Math.round(value));
}

function formatDateRange(start?: string | null, end?: string | null): string {
  const fmt = (value?: string | null): string | null => {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: '2-digit',
      year: 'numeric',
    });
  };
  const s = fmt(start);
  const e = fmt(end);
  if (s && e) return `${s} - ${e}`;
  return s ?? e ?? 'Dates not set';
}

function refundAmountOf(item: LeanCancellationItem): number {
  const amount =
    typeof item.total_price === 'number' && Number.isFinite(item.total_price)
      ? item.total_price
      : typeof item.gross_amount === 'number' && Number.isFinite(item.gross_amount)
        ? item.gross_amount
        : 0;
  return Math.max(0, Math.round(amount));
}

function isCancelledStatus(value: unknown): boolean {
  return CANCELLED_STATUSES.has(normalizeStatus(value));
}

async function recomputeBookingStatus(bookingId: string, updatedAt: string): Promise<void> {
  const items = (await BookingItem.find({ booking_id: bookingId })
    .select({ item_status: 1 })
    .lean()) as Array<Pick<LeanCancellationItem, 'item_status'>>;
  const statuses = items.map((item) => normalizeStatus(item.item_status));
  const nextStatus =
    statuses.length > 0 && statuses.every((status) => isCancelledStatus(status))
      ? 'CANCELLED'
      : statuses.some((status) => status === CANCELLATION_PENDING_STATUS)
        ? CANCELLATION_PENDING_STATUS
        : statuses.some((status) => CONFIRMED_STATUSES.has(status))
          ? 'CONFIRMED'
          : 'PENDING';

  await Booking.updateOne(
    { _id: bookingId },
    { $set: { status: nextStatus, updated_at: updatedAt } },
  );
}

async function loadRequestMaps(items: LeanCancellationItem[]) {
  const bookingIds = Array.from(new Set(items.map((item) => item.booking_id)));
  const bookings = (await Booking.find({ _id: { $in: bookingIds } })
    .select({ _id: 1, user_id: 1, status: 1 })
    .lean()) as LeanBooking[];
  const bookingMap = new Map(bookings.map((booking) => [String(booking._id), booking] as const));

  const userIds = Array.from(
    new Set(
      bookings
        .map((booking) => booking.user_id)
        .filter((userId): userId is string => typeof userId === 'string' && userId.length > 0),
    ),
  );
  const users = (await User.find({
    _id: { $in: userIds },
  })
    .select({ _id: 1, full_name: 1, email: 1 })
    .lean()) as LeanUser[];
  const userMap = new Map(users.map((user) => [user._id, user] as const));

  const roomIds = Array.from(
    new Set(items.map((item) => item.room_id).filter((id): id is number => typeof id === 'number')),
  );
  const rooms = (await Room.find({ _id: { $in: roomIds } })
    .select({ _id: 1, hotel_id: 1, room_type: 1 })
    .lean()) as LeanRoom[];
  const roomMap = new Map(rooms.map((room) => [room._id, room] as const));

  const hotels = (await Hotel.find({
    _id: { $in: Array.from(new Set(rooms.map((room) => room.hotel_id))) },
  })
    .select({ _id: 1, name: 1, address: 1, provider_id: 1 })
    .lean()) as LeanHotel[];
  const hotelMap = new Map(hotels.map((hotel) => [hotel._id, hotel] as const));

  const providerIds = Array.from(new Set(items.map((item) => item.provider_id).filter(Boolean)));
  const providers = (await Provider.find({ _id: { $in: providerIds } })
    .select({ _id: 1, business_name: 1, user_id: 1 })
    .lean()) as LeanProvider[];
  const providerMap = new Map(providers.map((provider) => [provider._id, provider] as const));

  return { bookingMap, userMap, roomMap, hotelMap, providerMap };
}

function mapRequest(
  item: LeanCancellationItem,
  maps: Awaited<ReturnType<typeof loadRequestMaps>>,
): AdminCancellationRequest {
  const booking = maps.bookingMap.get(item.booking_id);
  const user = booking?.user_id ? maps.userMap.get(booking.user_id) : undefined;
  const room = item.room_id != null ? maps.roomMap.get(item.room_id) : undefined;
  const hotel = room ? maps.hotelMap.get(room.hotel_id) : undefined;
  const provider = maps.providerMap.get(item.provider_id);
  const amount = refundAmountOf(item);

  return {
    id: item._id,
    bookingId: item.booking_id,
    userId: booking?.user_id ?? '',
    userName: user?.full_name?.trim() || user?.email || 'Tripwise user',
    userEmail: user?.email ?? null,
    providerId: item.provider_id,
    providerName: provider?.business_name ?? 'Tripwise provider',
    title: hotel?.name ?? 'Tripwise booking',
    subtitle: room?.room_type ? `${room.room_type} - ${hotel?.address ?? ''}` : hotel?.address ?? '',
    dateLabel: formatDateRange(item.start_date, item.end_date),
    requestedAt: item.cancellation_requested_at ?? null,
    cancelDeadline: item.cancellation_deadline ?? null,
    amount,
    displayAmount: formatCurrency(amount),
  };
}

export async function listAdminCancellationRequests(): Promise<AdminCancellationRequestsResponse> {
  const items = (await BookingItem.find({
    item_status: CANCELLATION_PENDING_STATUS,
    cancellation_status: 'PENDING',
  })
    .sort({ cancellation_requested_at: 1, created_at: 1, _id: 1 })
    .lean()) as LeanCancellationItem[];

  const maps = await loadRequestMaps(items);
  const requests = items.map((item) => mapRequest(item, maps));
  const totalRefundAmount = requests.reduce((sum, request) => sum + request.amount, 0);

  return {
    pendingCount: requests.length,
    totalRefundAmount,
    displayTotalRefundAmount: formatCurrency(totalRefundAmount),
    requests,
  };
}

export async function reviewCancellationRequest(input: {
  actorId: string;
  bookingItemId: string;
  decision: unknown;
}): Promise<AdminCancellationReviewResponse> {
  const decision = normalizeDecision(input.decision);
  const bookingItemId = input.bookingItemId.trim();
  if (!bookingItemId) throw new AdminCancellationError(400, 'Invalid booking item id');

  const item = (await BookingItem.findOne({
    _id: bookingItemId,
    item_status: CANCELLATION_PENDING_STATUS,
    cancellation_status: 'PENDING',
  }).lean()) as LeanCancellationItem | null;
  if (!item) throw new AdminCancellationError(404, 'Cancellation request not found');

  const booking = (await Booking.findOne({ _id: item.booking_id }).lean()) as LeanBooking | null;
  if (!booking?.user_id) throw new AdminCancellationError(404, 'Booking owner not found');

  const now = new Date().toISOString();
  const refundAmount = refundAmountOf(item);

  if (decision === 'REJECTED') {
    const previousStatus = normalizeStatus(item.cancellation_previous_status) || 'PENDING';
    await BookingItem.updateOne(
      { _id: bookingItemId },
      {
        $set: {
          item_status: previousStatus,
          cancellation_status: 'REJECTED',
          cancellation_reviewed_at: now,
          cancellation_reviewed_by: input.actorId,
          updated_at: now,
        },
      },
    );
    await recomputeBookingStatus(item.booking_id, now);
    await createNotification({
      userId: booking.user_id,
      type: 'BOOKING',
      title: 'Cancellation request rejected',
      body: 'Your booking is still active. Please contact support if you need help.',
      actionRoute: '/my_trips?status=upcoming',
    });
    return {
      bookingItemId,
      bookingId: item.booking_id,
      status: 'REJECTED',
      refundAmount: 0,
      displayRefundAmount: formatCurrency(0),
      message: 'Cancellation request rejected.',
    };
  }

  if (refundAmount <= 0) {
    throw new AdminCancellationError(400, 'Refund amount must be greater than zero');
  }
  if (normalizeStatus(item.escrow_status) !== 'HELD') {
    throw new AdminCancellationError(409, 'Only held escrow bookings can be refunded');
  }

  await ensureWallet(env.adminWalletUserId);
  const adminWallet = await Wallet.findOne({ user_id: env.adminWalletUserId }).lean();
  if ((adminWallet?.balance ?? 0) < refundAmount) {
    throw new AdminCancellationError(400, 'Admin wallet does not have enough held balance');
  }

  await debitWallet({
    userId: env.adminWalletUserId,
    amount: refundAmount,
    type: 'BOOKING_REFUND_OUT',
    status: 'REFUNDED',
    bookingId: item.booking_id,
    bookingItemId,
    providerId: item.provider_id,
    note: 'Admin approved cancellation refund to user',
  });
  await creditWallet({
    userId: booking.user_id,
    amount: refundAmount,
    type: 'BOOKING_REFUND_IN',
    status: 'REFUNDED',
    bookingId: item.booking_id,
    bookingItemId,
    providerId: item.provider_id,
    note: 'Booking cancellation refund',
  });

  await BookingItem.updateOne(
    { _id: bookingItemId },
    {
      $set: {
        item_status: 'CANCELLED',
        escrow_status: 'REFUNDED',
        cancellation_status: 'APPROVED',
        cancellation_reviewed_at: now,
        cancellation_reviewed_by: input.actorId,
        refund_amount: refundAmount,
        refunded_at: now,
        updated_at: now,
      },
    },
  );

  await recomputeBookingStatus(item.booking_id, now);
  const siblingItems = (await BookingItem.find({ booking_id: item.booking_id })
    .select({ item_status: 1 })
    .lean()) as Array<Pick<LeanCancellationItem, 'item_status'>>;
  const allCancelled = siblingItems.every((row) => isCancelledStatus(row.item_status));
  await Payment.updateMany(
    { booking_id: item.booking_id },
    { $set: { status: allCancelled ? 'REFUNDED' : 'PARTIALLY_REFUNDED', updated_at: now } },
  );

  await createNotification({
    userId: booking.user_id,
    type: 'BOOKING',
    title: 'Cancellation approved',
    body: `${formatCurrency(refundAmount)} has been refunded to your Tripwise wallet.`,
    actionRoute: '/wallet_loyalty',
  });

  return {
    bookingItemId,
    bookingId: item.booking_id,
    status: 'CANCELLED',
    refundAmount,
    displayRefundAmount: formatCurrency(refundAmount),
    message: 'Cancellation approved and refunded.',
  };
}
