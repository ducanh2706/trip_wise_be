import { PayOS } from '@payos/node';
import { env } from '@/config/env';

type PayOSPaymentLink = {
  paymentLinkId: string;
  checkoutUrl: string;
  qrCode: string;
  status: string;
  orderCode: number;
  expiredAt: number;
};

type PayOSPaymentLinkStatus = {
  id: string;
  orderCode: number;
  amount: number;
  amountPaid: number;
  amountRemaining: number;
  status: string;
  createdAt: string;
  canceledAt: string | null;
  cancellationReason: string | null;
  transactions: Array<{ reference: string }>;
};

let cachedPayOS: PayOS | null = null;

function isConfigured(): boolean {
  return (
    env.payosClientId.length > 0 &&
    env.payosApiKey.length > 0 &&
    env.payosChecksumKey.length > 0
  );
}

function requireConfigured(): void {
  if (!isConfigured()) {
    throw new Error('PayOS is not configured');
  }
}

function client(): PayOS {
  requireConfigured();
  if (!cachedPayOS) {
    cachedPayOS = new PayOS({
      clientId: env.payosClientId,
      apiKey: env.payosApiKey,
      checksumKey: env.payosChecksumKey,
    });
  }
  return cachedPayOS;
}

export function isPayOSEnabled(): boolean {
  return isConfigured();
}

export async function createPayOSPaymentLink(input: {
  orderCode: number;
  amount: number;
  description: string;
  itemName: string;
  quantity: number;
  returnUrl?: string;
  cancelUrl?: string;
  buyerName?: string;
  buyerEmail?: string | null;
  buyerPhone?: string | null;
}): Promise<PayOSPaymentLink> {
  const now = Math.floor(Date.now() / 1000);
  const expiredAt = now + env.payosQrExpireSeconds;
  const paymentLink = await client().paymentRequests.create({
    orderCode: input.orderCode,
    amount: Math.max(1, Math.round(input.amount)),
    description: input.description,
    cancelUrl: input.cancelUrl?.trim() || env.payosCancelUrl,
    returnUrl: input.returnUrl?.trim() || env.payosReturnUrl,
    expiredAt,
    items: [
      {
        name: input.itemName.slice(0, 120) || 'Tripwise booking',
        quantity: Math.max(1, Math.floor(input.quantity)),
        price: Math.max(1, Math.round(input.amount)),
      },
    ],
    buyerName: input.buyerName?.trim() || undefined,
    buyerEmail: input.buyerEmail?.trim() || undefined,
    buyerPhone: input.buyerPhone?.trim() || undefined,
  });

  return {
    paymentLinkId: paymentLink.paymentLinkId,
    checkoutUrl: paymentLink.checkoutUrl,
    qrCode: paymentLink.qrCode,
    status: paymentLink.status,
    orderCode: paymentLink.orderCode,
    expiredAt: paymentLink.expiredAt ?? expiredAt,
  };
}

export async function getPayOSPaymentLinkStatus(
  paymentLinkIdOrOrderCode: string | number,
): Promise<PayOSPaymentLinkStatus> {
  const paymentLink =
    typeof paymentLinkIdOrOrderCode === 'string'
      ? await client().paymentRequests.get(paymentLinkIdOrOrderCode)
      : await client().paymentRequests.get(paymentLinkIdOrOrderCode);
  return {
    id: paymentLink.id,
    orderCode: paymentLink.orderCode,
    amount: paymentLink.amount,
    amountPaid: paymentLink.amountPaid,
    amountRemaining: paymentLink.amountRemaining,
    status: paymentLink.status,
    createdAt: paymentLink.createdAt,
    canceledAt: paymentLink.canceledAt,
    cancellationReason: paymentLink.cancellationReason,
    transactions: (paymentLink.transactions ?? []).map((item) => ({
      reference: item.reference,
    })),
  };
}
