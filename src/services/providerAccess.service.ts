import { Provider, type ProviderDoc } from '@/models/Provider.model';

export class ProviderAccessError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export type LeanProviderAccess = Pick<ProviderDoc, '_id' | 'business_name' | 'user_id' | 'status'> & {
  vip_plan?: string | null;
  vip_promotions?: Array<Record<string, unknown>> | null;
};

export async function resolveProviderForUser(userId: string): Promise<LeanProviderAccess> {
  const provider = (await Provider.findOne({
    $or: [{ user_id: userId }, { _id: userId }],
  })
    .select({
      _id: 1,
      user_id: 1,
      business_name: 1,
      status: 1,
      vip_plan: 1,
      vip_promotions: 1,
    })
    .lean()) as LeanProviderAccess | null;

  if (!provider?._id) {
    throw new ProviderAccessError(404, 'Provider profile not found for this account');
  }

  return provider;
}

export async function resolveProviderIdForUser(userId: string): Promise<string> {
  const provider = await resolveProviderForUser(userId);
  return provider._id;
}
