import { randomUUID } from 'node:crypto';
import { DirectConversation, type DirectConversationDoc } from '@/models/DirectConversation.model';
import { DirectMessage, type DirectMessageDoc } from '@/models/DirectMessage.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Provider } from '@/models/Provider.model';
import { Room } from '@/models/Room.model';
import { User } from '@/models/User.model';
import { createNotification } from '@/services/notifications.service';

const MESSAGE_LIMIT = 100;
const CONVERSATION_LIMIT = 50;

export class DirectMessageError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ConversationItem {
  id: string;
  title: string;
  subtitle: string;
  avatarUrl: string | null;
  providerId: string | null;
  bookingId: string | null;
  listingId: number | null;
  lastMessage: string;
  lastMessageAt: string | null;
  unread: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface DirectMessageItem {
  id: string;
  conversationId: string;
  senderUserId: string;
  body: string;
  isMine: boolean;
  read: boolean;
  createdAt: string | null;
  timeLabel: string;
  dateLabel: string;
}

export interface ConversationDetail {
  conversation: ConversationItem;
  messages: DirectMessageItem[];
}

export interface ConversationPage {
  items: ConversationItem[];
  total: number;
}

function normalizeBody(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function formatDateLabel(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const then = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const diffDays = Math.round((today - then) / 86_400_000);
  if (diffDays === 0) return 'TODAY';
  if (diffDays === 1) return 'YESTERDAY';
  return date.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
}

function mapConversation(row: DirectConversationDoc, userId: string): ConversationItem {
  return {
    id: row._id,
    title: row.title ?? 'Tripwise guest',
    subtitle: row.subtitle ?? 'Direct message',
    avatarUrl: row.avatar_url ?? null,
    providerId: row.provider_id ?? null,
    bookingId: row.booking_id ?? null,
    listingId: row.listing_id ?? null,
    lastMessage: row.last_message ?? '',
    lastMessageAt: row.last_message_at ?? null,
    unread: (row.unread_by ?? []).includes(userId),
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function mapMessage(row: DirectMessageDoc, userId: string): DirectMessageItem {
  const createdAt = row.created_at ?? null;
  return {
    id: row._id,
    conversationId: row.conversation_id,
    senderUserId: row.sender_user_id,
    body: row.body,
    isMine: row.sender_user_id === userId,
    read: (row.read_by ?? []).includes(userId),
    createdAt,
    timeLabel: formatTime(createdAt),
    dateLabel: formatDateLabel(createdAt),
  };
}

async function loadConversationForUser(
  userId: string,
  conversationId: string,
): Promise<DirectConversationDoc> {
  const conversation = await DirectConversation.findOne({
    _id: conversationId,
    participant_user_ids: userId,
  }).lean();

  if (!conversation) {
    throw new DirectMessageError(404, 'Conversation not found');
  }

  return conversation as DirectConversationDoc;
}

export async function listConversations(userId: string): Promise<ConversationPage> {
  const [total, rows] = await Promise.all([
    DirectConversation.countDocuments({ participant_user_ids: userId }),
    DirectConversation.find({ participant_user_ids: userId })
      .sort({ last_message_at: -1, updated_at: -1 })
      .limit(CONVERSATION_LIMIT)
      .lean(),
  ]);

  return {
    items: (rows as DirectConversationDoc[]).map((row) => mapConversation(row, userId)),
    total,
  };
}

export async function getConversation(
  userId: string,
  conversationId: string,
): Promise<ConversationDetail> {
  const conversation = await loadConversationForUser(userId, conversationId);
  const messages = (await DirectMessage.find({ conversation_id: conversationId })
    .sort({ created_at: 1, _id: 1 })
    .limit(MESSAGE_LIMIT)
    .lean()) as DirectMessageDoc[];

  return {
    conversation: mapConversation(conversation, userId),
    messages: messages.map((message) => mapMessage(message, userId)),
  };
}

export async function createConversation(
  userId: string,
  body: unknown,
): Promise<ConversationDetail> {
  const input = (body ?? {}) as Record<string, unknown>;
  const peerId = normalizeBody(input.participantUserId);
  if (!peerId) throw new DirectMessageError(400, 'participantUserId is required');
  if (peerId === userId) throw new DirectMessageError(400, 'Cannot message yourself');

  const existing = await DirectConversation.findOne({
    participant_user_ids: { $all: [userId, peerId] },
    booking_id: typeof input.bookingId === 'string' ? input.bookingId : null,
  }).lean();
  if (existing) return getConversation(userId, existing._id);

  const now = new Date().toISOString();
  const [peer, provider, hotel] = await Promise.all([
    User.findById(peerId).select({ full_name: 1, email: 1, image: 1 }).lean(),
    typeof input.providerId === 'string' ? Provider.findById(input.providerId).lean() : null,
    typeof input.listingId === 'number'
      ? Hotel.findById(input.listingId).select({ name: 1, image: 1 }).lean()
      : null,
  ]);

  const conversation = (await DirectConversation.create({
    _id: randomUUID(),
    participant_user_ids: [userId, peerId],
    provider_id: typeof input.providerId === 'string' ? input.providerId : null,
    booking_id: typeof input.bookingId === 'string' ? input.bookingId : null,
    listing_id: typeof input.listingId === 'number' ? input.listingId : null,
    title: peer?.full_name ?? peer?.email ?? 'Tripwise guest',
    subtitle: hotel?.name ?? provider?.business_name ?? 'Direct message',
    avatar_url: peer?.image ?? hotel?.image ?? null,
    last_message: '',
    last_message_at: null,
    unread_by: [],
    created_at: now,
    updated_at: now,
  })) as DirectConversationDoc;

  return { conversation: mapConversation(conversation, userId), messages: [] };
}

export async function createConversationFromOrder(
  userId: string,
  orderItemId: string,
): Promise<ConversationDetail> {
  const normalizedOrderItemId = normalizeBody(orderItemId);
  if (!normalizedOrderItemId) {
    throw new DirectMessageError(400, 'orderId is required');
  }

  const item = await BookingItem.findById(normalizedOrderItemId).lean();
  if (!item) {
    throw new DirectMessageError(404, 'Order not found');
  }

  const [booking, provider, room] = await Promise.all([
    Booking.findById(item.booking_id).lean(),
    Provider.findById(item.provider_id).lean(),
    item.room_id ? Room.findById(item.room_id).select({ hotel_id: 1, image: 1 }).lean() : null,
  ]);

  const guestId = typeof booking?.user_id === 'string' ? booking.user_id : null;
  const providerUserId = typeof provider?.user_id === 'string' ? provider.user_id : null;
  const isGuest = guestId === userId;

  if (!guestId) {
    throw new DirectMessageError(404, 'Order guest not found');
  }

  const peerId = isGuest ? (providerUserId ?? item.provider_id) : guestId;
  if (!peerId || peerId === userId) {
    throw new DirectMessageError(400, 'Conversation recipient is not available');
  }

  const existing = await DirectConversation.findOne({
    participant_user_ids: { $all: [userId, peerId] },
    booking_id: item.booking_id,
  }).lean();
  if (existing) return getConversation(userId, existing._id);

  const [guest, peer, hotel] = await Promise.all([
    User.findById(guestId).select({ full_name: 1, email: 1, image: 1 }).lean(),
    User.findById(peerId).select({ full_name: 1, email: 1, image: 1 }).lean(),
    room?.hotel_id
      ? Hotel.findById(room.hotel_id).select({ _id: 1, name: 1, image: 1 }).lean()
      : null,
  ]);

  const now = new Date().toISOString();
  const conversation = (await DirectConversation.create({
    _id: randomUUID(),
    participant_user_ids: [userId, peerId],
    provider_id: item.provider_id ?? null,
    booking_id: item.booking_id,
    listing_id: hotel?._id ?? null,
    title:
      peer?.full_name ??
      peer?.email ??
      (isGuest ? provider?.business_name : guest?.full_name) ??
      'Tripwise guest',
    subtitle: hotel?.name ?? provider?.business_name ?? `Booking ${item.booking_id}`,
    avatar_url: peer?.image ?? hotel?.image ?? room?.image ?? null,
    last_message: '',
    last_message_at: null,
    unread_by: [],
    created_at: now,
    updated_at: now,
  })) as DirectConversationDoc;

  return { conversation: mapConversation(conversation, userId), messages: [] };
}

export async function sendMessage(
  userId: string,
  conversationId: string,
  body: unknown,
): Promise<DirectMessageItem> {
  const text = normalizeBody((body as Record<string, unknown> | null)?.body);
  if (!text) throw new DirectMessageError(400, 'Message body is required');
  if (text.length > 2000) throw new DirectMessageError(400, 'Message body is too long');

  const conversation = await loadConversationForUser(userId, conversationId);
  const now = new Date().toISOString();
  const recipients = conversation.participant_user_ids.filter((id) => id !== userId);
  const message = (await DirectMessage.create({
    _id: randomUUID(),
    conversation_id: conversationId,
    sender_user_id: userId,
    body: text,
    read_by: [userId],
    created_at: now,
    updated_at: now,
  })) as DirectMessageDoc;

  await DirectConversation.updateOne(
    { _id: conversationId },
    {
      $set: {
        last_message: text,
        last_message_at: now,
        updated_at: now,
      },
      $addToSet: { unread_by: { $each: recipients } },
    },
  );
  await DirectConversation.updateOne({ _id: conversationId }, { $pull: { unread_by: userId } });

  await Promise.all(
    recipients.map((recipientId) =>
      createNotification({
        userId: recipientId,
        type: 'MESSAGE',
        title: conversation.title ?? 'New message',
        body: text,
        actionRoute: `/direct_messaging?conversationId=${encodeURIComponent(conversationId)}`,
      }),
    ),
  );

  return mapMessage(message, userId);
}

export async function markConversationRead(
  userId: string,
  conversationId: string,
): Promise<ConversationItem> {
  const conversation = await loadConversationForUser(userId, conversationId);

  await Promise.all([
    DirectConversation.updateOne({ _id: conversationId }, { $pull: { unread_by: userId } }),
    DirectMessage.updateMany(
      { conversation_id: conversationId, sender_user_id: { $ne: userId } },
      { $addToSet: { read_by: userId } },
    ),
  ]);

  return mapConversation(
    { ...conversation, unread_by: (conversation.unread_by ?? []).filter((id) => id !== userId) },
    userId,
  );
}
