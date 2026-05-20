import { env } from '@/config/env';
import { Activity } from '@/models/Activity.model';
import { Booking } from '@/models/Booking.model';
import { BookingItem } from '@/models/BookingItem.model';
import { Hotel } from '@/models/Hotel.model';
import { Review } from '@/models/Review.model';
import { Room } from '@/models/Room.model';

type ChatIntent =
  | 'greeting'
  | 'ask_price'
  | 'ask_itinerary'
  | 'suggest_destination'
  | 'book_tour'
  | 'hotel_booking'
  | 'booking_status'
  | 'cancel_policy'
  | 'refund_time'
  | 'payment_method'
  | 'voucher'
  | 'wallet'
  | 'review'
  | 'provider_support'
  | 'contact_support'
  | 'thanks'
  | 'unknown';

interface ChatRule {
  intent: ChatIntent;
  keywords: string[];
}

interface ChatEntities {
  destination?: string;
  bookingId?: string;
}

interface ChatContextItem {
  type: 'hotel' | 'tour' | 'booking' | 'reviewSummary' | 'policy';
  title: string;
  details: Record<string, unknown>;
}

export interface ChatResponse {
  reply: string;
  intent: ChatIntent;
  source: 'rule' | 'rule+mongodb' | 'rule+mongodb+llm';
  matchedItems: ChatContextItem[];
}

const priceFormatter = new Intl.NumberFormat('vi-VN');

const rules: ChatRule[] = [
  { intent: 'greeting', keywords: ['xin chao', 'chao', 'hello', 'hi'] },
  {
    intent: 'ask_price',
    keywords: ['gia', 'bao nhieu', 'chi phi', 've', 'price', 'cost'],
  },
  {
    intent: 'ask_itinerary',
    keywords: ['lich trinh', 'itinerary', 'ke hoach', 'di may ngay'],
  },
  {
    intent: 'suggest_destination',
    keywords: ['goi y', 'dia diem', 'nen di dau', 'du lich o dau', 'recommend'],
  },
  {
    intent: 'book_tour',
    keywords: ['dat tour', 'booking', 'dang ky tour', 'mua tour', 'dat phong'],
  },
  {
    intent: 'hotel_booking',
    keywords: ['khach san', 'hotel', 'phong', 'check in', 'check out'],
  },
  {
    intent: 'booking_status',
    keywords: ['kiem tra booking', 'trang thai booking', 'don cua toi', 'my trips'],
  },
  {
    intent: 'cancel_policy',
    keywords: ['huy', 'hoan tien', 'doi lich', 'cancel', 'refund'],
  },
  {
    intent: 'refund_time',
    keywords: ['bao lau hoan tien', 'khi nao hoan tien', 'tien ve dau'],
  },
  {
    intent: 'payment_method',
    keywords: ['thanh toan', 'payment', 'the ngan hang', 'momo', 'zalopay'],
  },
  {
    intent: 'voucher',
    keywords: ['ma giam gia', 'voucher', 'coupon', 'khuyen mai', 'promo'],
  },
  { intent: 'wallet', keywords: ['wallet', 'vi tripwise', 'so du', 'diem thuong'] },
  { intent: 'review', keywords: ['danh gia', 'review', 'rating', 'nhan xet'] },
  {
    intent: 'provider_support',
    keywords: ['provider', 'nha cung cap', 'listing', 'quan ly don', 'rut tien'],
  },
  {
    intent: 'contact_support',
    keywords: ['lien he', 'ho tro', 'support', 'tu van vien', 'hotline'],
  },
  { intent: 'thanks', keywords: ['cam on', 'thank', 'thanks'] },
];

const destinationAliases = [
  'Đà Lạt',
  'Đà Nẵng',
  'Phú Quốc',
  'Nha Trang',
  'Sa Pa',
  'Hội An',
  'Hà Nội',
  'TP Hồ Chí Minh',
  'Huế',
  'Hạ Long',
];

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function formatVnd(value: number | null | undefined): string {
  if (typeof value !== 'number') return 'chưa có giá';
  return `${priceFormatter.format(Math.round(value))}đ`;
}

function detectIntent(message: string): ChatIntent {
  const normalized = normalize(message);
  let bestIntent: ChatIntent = 'unknown';
  let bestScore = 0;

  for (const rule of rules) {
    const score = rule.keywords.reduce((total, keyword) => {
      return normalized.includes(normalize(keyword)) ? total + 1 : total;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      bestIntent = rule.intent;
    }
  }

  return bestIntent;
}

function extractEntities(message: string): ChatEntities {
  const normalized = normalize(message);
  const destination = destinationAliases.find((name) => normalized.includes(normalize(name)));
  const bookingId = message.match(/[A-Z0-9]{6,}|[a-f0-9-]{24,}/i)?.[0];
  return { destination, bookingId };
}

async function loadTravelContext(
  intent: ChatIntent,
  entities: ChatEntities,
  userId?: string,
): Promise<ChatContextItem[]> {
  const items: ChatContextItem[] = [];
  const searchText = entities.destination?.trim();
  const nameMatch = searchText ? { $regex: escapeRegExp(searchText), $options: 'i' } : undefined;

  if (['ask_price', 'ask_itinerary', 'suggest_destination', 'book_tour'].includes(intent)) {
    const tours = await Activity.find({
      deleted_at: null,
      status: 'LIVE',
      type: 'TOUR',
      ...(nameMatch ? { title: nameMatch } : {}),
    })
      .select({
        _id: 1,
        title: 1,
        base_price: 1,
        category: 1,
        rating: 1,
        description: 1,
      })
      .sort({ rating: -1, base_price: 1, _id: 1 })
      .limit(5)
      .lean();

    items.push(
      ...tours.map((tour) => ({
        type: 'tour' as const,
        title: tour.title,
        details: {
          id: tour._id,
          price: formatVnd(tour.base_price),
          category: tour.category ?? null,
          rating: tour.rating ?? null,
          description: tour.description ?? null,
        },
      })),
    );
  }

  if (['ask_price', 'hotel_booking', 'suggest_destination', 'book_tour'].includes(intent)) {
    const hotels = await Hotel.find({
      deleted_at: null,
      ...(nameMatch ? { $or: [{ name: nameMatch }, { address: nameMatch }] } : {}),
    })
      .select({ _id: 1, name: 1, address: 1, star_rating: 1, description: 1 })
      .sort({ star_rating: -1, _id: 1 })
      .limit(5)
      .lean();
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

    items.push(
      ...hotels.map((hotel) => ({
        type: 'hotel' as const,
        title: hotel.name,
        details: {
          id: hotel._id,
          address: hotel.address,
          stars: hotel.star_rating,
          priceFrom: formatVnd(priceByHotelId.get(hotel._id)),
          description: hotel.description ?? null,
        },
      })),
    );
  }

  if (intent === 'booking_status' && userId) {
    const bookingFilter: Record<string, unknown> = {
      user_id: userId,
      deleted_at: null,
    };
    if (entities.bookingId) {
      bookingFilter._id = entities.bookingId;
    }

    const bookings = await Booking.find(bookingFilter)
      .select({
        _id: 1,
        status: 1,
        final_amount: 1,
        total_price: 1,
        currency: 1,
        created_at: 1,
      })
      .sort({ created_at: -1, _id: -1 })
      .limit(3)
      .lean();

    items.push(
      ...bookings.map((booking) => ({
        type: 'booking' as const,
        title: `Booking ${String(booking._id)}`,
        details: {
          id: String(booking._id),
          status: booking.status,
          amount: formatVnd(booking.final_amount || booking.total_price),
          createdAt: booking.created_at ?? null,
        },
      })),
    );

    if (bookings.length > 0) {
      const bookingIds = bookings.map((booking) => String(booking._id));
      const bookingItems = await BookingItem.find({
        booking_id: { $in: bookingIds },
      })
        .select({ booking_id: 1, item_status: 1, start_date: 1, end_date: 1 })
        .limit(6)
        .lean();
      items.push(
        ...bookingItems.map((item) => ({
          type: 'booking' as const,
          title: `Chi tiết ${item.booking_id}`,
          details: {
            status: item.item_status,
            startDate: item.start_date ?? null,
            endDate: item.end_date ?? null,
          },
        })),
      );
    }
  }

  if (intent === 'review') {
    const hotels = await Hotel.find({
      deleted_at: null,
      ...(nameMatch ? { $or: [{ name: nameMatch }, { address: nameMatch }] } : {}),
    })
      .select({ _id: 1, name: 1 })
      .limit(3)
      .lean();
    const stats = await Review.aggregate<{
      _id: number;
      average: number;
      count: number;
    }>([
      { $match: { hotel_id: { $in: hotels.map((hotel) => hotel._id) }, deleted_at: null } },
      { $group: { _id: '$hotel_id', average: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const statByHotelId = new Map(stats.map((stat) => [stat._id, stat] as const));
    items.push(
      ...hotels.map((hotel) => ({
        type: 'reviewSummary' as const,
        title: hotel.name,
        details: {
          average: Math.round((statByHotelId.get(hotel._id)?.average ?? 0) * 10) / 10,
          count: statByHotelId.get(hotel._id)?.count ?? 0,
        },
      })),
    );
  }

  if (['cancel_policy', 'refund_time', 'payment_method', 'voucher', 'wallet'].includes(intent)) {
    items.push({
      type: 'policy',
      title: 'Chính sách TripWise',
      details: {
        cancellation:
          'Điều kiện hủy/đổi lịch phụ thuộc từng dịch vụ và hiển thị trong chi tiết booking.',
        refund:
          'Thời gian hoàn tiền phụ thuộc phương thức thanh toán và trạng thái xử lý của nhà cung cấp.',
        payment:
          'Người dùng nên kiểm tra tổng tiền, ngày đi, voucher và chính sách hủy trước khi xác nhận thanh toán.',
      },
    });
  }

  return items.slice(0, 10);
}

function templateReply(intent: ChatIntent, context: ChatContextItem[]): string {
  if (intent === 'greeting') {
    return 'Xin chào! Mình có thể hỗ trợ bạn tìm tour, hỏi giá, xem booking, chính sách hủy/hoàn tiền hoặc gợi ý lịch trình.';
  }
  if (intent === 'thanks') {
    return 'Rất vui được hỗ trợ bạn. Bạn cần mình giúp thêm phần nào cho chuyến đi không?';
  }
  if (intent === 'contact_support') {
    return 'Bạn có thể gửi tin nhắn tại màn hình này hoặc vào Profile > Help Center để xem kênh hỗ trợ phù hợp.';
  }
  if (intent === 'provider_support') {
    return 'Nếu bạn là nhà cung cấp, hãy vào Provider Dashboard để quản lý listing, Order Manager để xử lý đơn và Finance/Payout để theo dõi doanh thu.';
  }

  const tours = context.filter((item) => item.type === 'tour');
  const hotels = context.filter((item) => item.type === 'hotel');
  const bookings = context.filter((item) => item.type === 'booking');

  if (intent === 'booking_status') {
    if (bookings.length === 0) {
      return 'Mình chưa tìm thấy booking phù hợp trong tài khoản của bạn. Bạn có thể kiểm tra mã booking hoặc mở mục My Trips để xem danh sách đơn.';
    }
    return `Mình tìm thấy ${bookings.length} thông tin booking liên quan:\n${bookings
      .slice(0, 4)
      .map((item) => `- ${item.title}: ${JSON.stringify(item.details)}`)
      .join('\n')}`;
  }

  if (intent === 'ask_price') {
    const lines = [...tours, ...hotels].slice(0, 5).map((item) => {
      const price = item.details.price ?? item.details.priceFrom ?? 'chưa có giá';
      return `- ${item.title}: từ ${price}`;
    });
    if (lines.length > 0) {
      return `Mình tìm thấy một số lựa chọn phù hợp:\n${lines.join('\n')}`;
    }
    return 'Mình chưa tìm thấy giá phù hợp trong dữ liệu hiện tại. Bạn hãy cho mình biết rõ điểm đến hoặc loại dịch vụ muốn tìm.';
  }

  if (['suggest_destination', 'book_tour', 'hotel_booking', 'ask_itinerary'].includes(intent)) {
    const lines = [...tours, ...hotels].slice(0, 5).map((item) => {
      const price = item.details.price ?? item.details.priceFrom ?? 'chưa có giá';
      return `- ${item.title}: ${price}`;
    });
    if (lines.length > 0) {
      return `Dựa trên dữ liệu TripWise, bạn có thể tham khảo:\n${lines.join('\n')}`;
    }
  }

  if (intent === 'cancel_policy') {
    return 'Điều kiện hủy hoặc đổi lịch phụ thuộc từng dịch vụ. Bạn nên mở booking trong My Trips để xem hạn hủy, mức phí nếu có và trạng thái hoàn tiền.';
  }
  if (intent === 'refund_time') {
    return 'Thời gian hoàn tiền phụ thuộc phương thức thanh toán và trạng thái xử lý của nhà cung cấp. Nếu quá thời gian dự kiến, bạn nên liên hệ hỗ trợ kèm mã booking.';
  }
  if (intent === 'payment_method') {
    return 'Bạn có thể thanh toán bằng các phương thức hiển thị ở màn hình checkout. Trước khi xác nhận, hãy kiểm tra ngày đi, tổng tiền, voucher và chính sách hủy.';
  }
  if (intent === 'voucher') {
    return 'Bạn có thể nhập mã giảm giá ở màn hình checkout nếu dịch vụ hỗ trợ. Một số voucher có điều kiện về ngày đi, giá trị đơn hoặc loại dịch vụ.';
  }
  if (intent === 'wallet') {
    return 'Bạn có thể xem số dư, điểm thưởng và lịch sử giao dịch trong mục Wallet.';
  }
  if (intent === 'review') {
    const reviews = context.filter((item) => item.type === 'reviewSummary');
    if (reviews.length > 0) {
      return `Tóm tắt đánh giá hiện có:\n${reviews
        .map(
          (item) => `- ${item.title}: ${item.details.average}/5 (${item.details.count} đánh giá)`,
        )
        .join('\n')}`;
    }
    return 'Bạn có thể xem đánh giá trong trang chi tiết dịch vụ hoặc để lại đánh giá sau khi hoàn tất chuyến đi.';
  }

  return 'Mình chưa có đủ thông tin để trả lời chính xác. Bạn có thể hỏi rõ hơn về điểm đến, giá, booking, thanh toán hoặc chính sách hủy tour.';
}

async function callLlm(input: {
  message: string;
  intent: ChatIntent;
  context: ChatContextItem[];
  template: string;
}): Promise<string | null> {
  if (!env.llmApiKey) return null;

  const prompt = JSON.stringify({
    instruction:
      'Bạn là trợ lý du lịch của TripWise. Chỉ dùng dữ liệu trong CONTEXT và câu trả lời nháp. Không bịa giá, trạng thái booking, chính sách hoặc dữ liệu không có trong context. Trả lời ngắn gọn, tiếng Việt có dấu.',
    question: input.message,
    intent: input.intent,
    context: input.context,
    draftAnswer: input.template,
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
        temperature: 0.2,
      },
    }),
  });

  if (!response.ok) return null;
  const data = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };
  return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
}

export async function answerChat(input: {
  message: string;
  userId?: string;
}): Promise<ChatResponse> {
  const message = input.message.trim();
  const intent = detectIntent(message);
  const entities = extractEntities(message);
  const context = await loadTravelContext(intent, entities, input.userId);
  const template = templateReply(intent, context);
  const llmReply = await callLlm({ message, intent, context, template });

  return {
    reply: llmReply ?? template,
    intent,
    source: llmReply ? 'rule+mongodb+llm' : context.length > 0 ? 'rule+mongodb' : 'rule',
    matchedItems: context,
  };
}
