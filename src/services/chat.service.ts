import { env } from '@/config/env';
import { Activity } from '@/models/Activity.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Location } from '@/models/Location.model';
import { PayoutRequest } from '@/models/PayoutRequest.model';
import { ProfileVerification } from '@/models/ProfileVerification.model';
import { Provider } from '@/models/Provider.model';
import { Room } from '@/models/Room.model';
import { Wallet } from '@/models/Wallet.model';

export interface ChatMessageContext {
  role: 'user' | 'assistant';
  text: string;
}

export interface ChatClientContext {
  route?: string;
  screenTitle?: string;
  locale?: string;
  history?: ChatMessageContext[];
}

export interface ChatResponse {
  reply: string;
  intent: 'api';
  source: 'api';
  matchedItems: unknown[];
}

export class ChatServiceError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const priceFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const UI_CONTEXT = {
  plannerTabs: ['Home', 'My Trips', 'Planner', 'Wallet', 'Profile'],
  providerTabs: ['Dashboard', 'Listings', 'Orders', 'VIP', 'Finance'],
  adminScreens: ['Provider approvals', 'Listing approvals', 'Payout requests', 'Refunds'],
  importantRoutes: {
    home: '/home',
    search: '/search_filter',
    myTrips: '/my_trips',
    wallet: '/wallet_transactions',
    profile: '/profile_registration',
    providerFinance: '/provider_finance',
    adminPayouts: '/admin_provider_payouts',
  },
  currentImplementedBehavior: [
    'Provider Finance lets providers choose a payout amount before creating a payout request.',
    'Admin Payouts reviews provider payout requests with Accept or Reject, not direct release.',
    'Accepted payout requests are committed and no longer available for a new request; rejected requests become available again.',
    'Provider Finance recent transactions support search, status filter, and view-all API loading.',
    'Planner Lumi chatbot uses API responses only.',
  ],
  profileVerificationGuide:
    'To upload passport: open Profile, find Verification, tap Continue or Verify Documents, choose Passport / Government document, then tap Tap to upload.',
};

const RECENT_USER_CONTEXT = [
  'The user asked to make Lumi use API calls only.',
  'The user wants Lumi to answer using the current app UI context, MongoDB data, and the conversation context sent by the client.',
  'The user recently tested provider payout amount selection, admin payout accept/reject, and provider finance transaction interactions.',
];

function sanitizeText(value: unknown, maxLength = 1200): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, maxLength);
}

function sanitizeChatReply(value: string): string {
  return value
    .replace(/`/g, '')
    .replace(/\s*\([^)]*\/[A-Za-z0-9_/?=&.-]+[^)]*\)/g, '')
    .replace(/(^|\s)\/[A-Za-z0-9_/?=&.-]+/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function searchRegex(message: string): RegExp | undefined {
  const tokens = normalize(message)
    .split(/\s+/)
    .map((token) => token.replace(/[^a-z0-9]/g, ''))
    .filter((token) => token.length >= 3 && !['list', 'tour', 'hotel', 'book', 'trip'].includes(token))
    .slice(0, 4);
  if (tokens.length === 0) return undefined;
  return new RegExp(tokens.map(escapeRegExp).join('|'), 'i');
}

function formatMoney(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? priceFormatter.format(Math.round(value))
    : 'No price';
}

async function loadPublicTravelData(message: string) {
  const regex = searchRegex(message);
  const activityFilter: Record<string, unknown> = {
    deleted_at: null,
    status: { $in: ['LIVE', 'ACTIVE', 'APPROVED', null] },
  };
  if (regex) {
    activityFilter.$or = [{ title: regex }, { description: regex }, { category: regex }];
  }

  const hotelFilter: Record<string, unknown> = {
    deleted_at: null,
  };
  if (regex) {
    hotelFilter.$or = [{ name: regex }, { address: regex }, { description: regex }];
  }

  const [activities, hotels, locations] = await Promise.all([
    Activity.find(activityFilter)
      .select({ _id: 1, title: 1, type: 1, base_price: 1, category: 1, rating: 1, status: 1 })
      .sort({ rating: -1, base_price: 1, _id: 1 })
      .limit(12)
      .lean(),
    Hotel.find(hotelFilter)
      .select({ _id: 1, name: 1, address: 1, star_rating: 1, location_id: 1, status: 1 })
      .sort({ star_rating: -1, _id: 1 })
      .limit(8)
      .lean(),
    Location.find(regex ? { name: regex } : {})
      .select({ _id: 1, name: 1, type: 1, parent_id: 1 })
      .sort({ _id: -1 })
      .limit(8)
      .lean(),
  ]);

  const roomPrices = await Room.aggregate<{ _id: number; priceFrom: number }>([
    {
      $match: {
        hotel_id: { $in: hotels.map((hotel) => hotel._id) },
        deleted_at: null,
      },
    },
    { $group: { _id: '$hotel_id', priceFrom: { $min: '$base_price' } } },
  ]);
  const priceByHotelId = new Map(roomPrices.map((room) => [room._id, room.priceFrom] as const));

  return {
    activities: activities.map((activity) => ({
      id: activity._id,
      title: activity.title,
      type: activity.type,
      price: formatMoney(activity.base_price),
      category: activity.category ?? null,
      rating: activity.rating ?? null,
      status: activity.status ?? null,
    })),
    hotels: hotels.map((hotel) => ({
      id: hotel._id,
      name: hotel.name,
      address: hotel.address,
      stars: hotel.star_rating,
      priceFrom: formatMoney(priceByHotelId.get(hotel._id)),
      status: hotel.status ?? null,
    })),
    locations: locations.map((location) => ({
      id: location._id,
      name: location.name,
      type: location.type ?? null,
      parentId: location.parent_id ?? null,
    })),
  };
}

async function loadUserData(userId?: string) {
  if (!userId) return null;

  const [wallet, bookings, provider, verification] = await Promise.all([
    Wallet.findOne({ user_id: userId })
      .select({ balance: 1, loyalty_points: 1, updated_at: 1 })
      .lean(),
    Booking.find({ user_id: userId, deleted_at: null })
      .select({ _id: 1, status: 1, final_amount: 1, total_price: 1, created_at: 1 })
      .sort({ created_at: -1, _id: -1 })
      .limit(5)
      .lean(),
    Provider.findOne({ $or: [{ user_id: userId }, { _id: userId }] })
      .select({ _id: 1, business_name: 1, status: 1, user_id: 1 })
      .lean(),
    ProfileVerification.findById(userId)
      .select({ passport_uploaded: 1, address_uploaded: 1, passport_note: 1, address_note: 1 })
      .lean(),
  ]);
  const bookingIds = bookings.map((booking) => String(booking._id));
  const providerId = provider?._id ?? userId;
  const [bookingItems, payoutRequests] = await Promise.all([
    BookingItem.find({ booking_id: { $in: bookingIds } })
      .select({ _id: 1, booking_id: 1, item_status: 1, start_date: 1, end_date: 1, total_price: 1 })
      .limit(10)
      .lean(),
    PayoutRequest.find({ provider_id: providerId })
      .select({ _id: 1, amount: 1, status: 1, requested_at: 1, reviewed_at: 1 })
      .sort({ requested_at: -1, _id: -1 })
      .limit(5)
      .lean(),
  ]);

  return {
    wallet: wallet
      ? {
          balance: formatMoney(wallet.balance),
          loyaltyPoints: wallet.loyalty_points ?? 0,
          updatedAt: wallet.updated_at ?? null,
        }
      : null,
    bookings: bookings.map((booking) => ({
      id: String(booking._id),
      status: booking.status,
      amount: formatMoney(booking.final_amount || booking.total_price),
      createdAt: booking.created_at ?? null,
    })),
    bookingItems: bookingItems.map((item) => ({
      id: item._id,
      bookingId: item.booking_id,
      status: item.item_status,
      startDate: item.start_date ?? null,
      endDate: item.end_date ?? null,
      total: formatMoney(item.total_price),
    })),
    provider: provider
      ? {
          id: provider._id,
          businessName: provider.business_name,
          status: provider.status,
        }
      : null,
    verification: verification
      ? {
          passportUploaded: Boolean(verification.passport_uploaded),
          addressUploaded: Boolean(verification.address_uploaded),
          passportNote: verification.passport_note ?? null,
          addressNote: verification.address_note ?? null,
        }
      : null,
    payoutRequests: payoutRequests.map((request) => ({
      id: request._id,
      amount: formatMoney(request.amount),
      status: request.status,
      requestedAt: request.requested_at ?? null,
      reviewedAt: request.reviewed_at ?? null,
    })),
  };
}

async function buildContext(input: {
  message: string;
  userId?: string;
  clientContext?: ChatClientContext;
}) {
  const [publicData, userData] = await Promise.all([
    loadPublicTravelData(input.message),
    loadUserData(input.userId),
  ]);

  return {
    currentScreen: {
      route: sanitizeText(input.clientContext?.route, 160) ?? null,
      title: sanitizeText(input.clientContext?.screenTitle, 120) ?? null,
      locale: sanitizeText(input.clientContext?.locale, 40) ?? null,
    },
    conversationHistory: (input.clientContext?.history ?? [])
      .slice(-8)
      .map((item) => ({
        role: item.role === 'assistant' ? 'assistant' : 'user',
        text: sanitizeText(item.text, 600) ?? '',
      }))
      .filter((item) => item.text.length > 0),
    uiContext: UI_CONTEXT,
    recentUserContext: RECENT_USER_CONTEXT,
    database: {
      publicData,
      userData,
    },
  };
}

async function callChatApi(input: {
  message: string;
  context: Awaited<ReturnType<typeof buildContext>>;
}): Promise<string> {
  if (!env.llmApiKey) {
    throw new ChatServiceError(503, 'Chat API key is not configured');
  }

  const prompt = JSON.stringify({
    instruction: [
      'You are Lumi Planner, the Tripwise travel assistant.',
      'You have access to the JSON context in UI_CONTEXT, DATABASE, CURRENT_SCREEN, RECENT_USER_CONTEXT, and CONVERSATION_HISTORY.',
      'Use that context to answer. Do not claim that you cannot access app data when relevant data is present in the JSON.',
      'If the exact data is absent, say what is missing and point to the relevant Tripwise screen.',
      'Do not include internal route paths, URLs, code ticks, or path hints such as /search_filter; mention the screen name only.',
      'For list questions, return concise bullet points using database records and prices/statuses when available.',
      'Reply in the same language as the user when obvious.',
    ].join(' '),
    userMessage: input.message,
    currentScreen: input.context.currentScreen,
    conversationHistory: input.context.conversationHistory,
    uiContext: input.context.uiContext,
    recentUserContext: input.context.recentUserContext,
    database: input.context.database,
  });

  const response = await fetch(env.llmApiUrl, {
    method: 'POST',
    headers: {
      'x-goog-api-key': env.llmApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        temperature: 0.25,
      },
    }),
  });

  if (!response.ok) {
    throw new ChatServiceError(response.status, 'Chat API request failed');
  }

  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  const reply = sanitizeChatReply(data.candidates?.[0]?.content?.parts?.[0]?.text ?? '');
  if (!reply) {
    throw new ChatServiceError(502, 'Chat API returned an empty response');
  }
  return reply;
}

export async function answerChat(input: {
  message: string;
  userId?: string;
  clientContext?: ChatClientContext;
}): Promise<ChatResponse> {
  const message = input.message.trim();
  const context = await buildContext({
    message,
    userId: input.userId,
    clientContext: input.clientContext,
  });
  const reply = await callChatApi({ message, context });

  return {
    reply,
    intent: 'api',
    source: 'api',
    matchedItems: [context.database.publicData, context.database.userData].filter(Boolean),
  };
}
