import { NextFunction, Request, Response } from 'express';
import {
  ProviderListingError,
  createProviderListing,
  deleteProviderListing,
  getProviderListingAnalytics,
  getProviderListingDetail,
  listProviderListings,
  replyToProviderListingReview,
  updateProviderListing,
} from '@/services/providerListings.service';
import { ProviderAccessError, resolveProviderIdForUser } from '@/services/providerAccess.service';

function handleProviderListingError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ProviderAccessError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  if (error instanceof ProviderListingError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

export async function listProviderListingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    res.json(
      await listProviderListings({
        providerId,
        query: req.query.query ?? req.query.q,
        status: req.query.status,
      }),
    );
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}

export async function getProviderListingDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    res.json(await getProviderListingDetail(providerId, req.params.id));
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}

export async function createProviderListingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const publicBaseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json(await createProviderListing(providerId, req.body ?? {}, publicBaseUrl));
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}

export async function updateProviderListingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const publicBaseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(await updateProviderListing(providerId, req.params.id, req.body ?? {}, publicBaseUrl));
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}

export async function replyToProviderListingReviewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    res.json(
      await replyToProviderListingReview(
        providerId,
        req.params.id,
        req.params.reviewId,
        req.body ?? {},
      ),
    );
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}

export async function deleteProviderListingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    res.json(await deleteProviderListing(providerId, req.params.id));
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}

export async function getProviderListingAnalyticsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    res.json(await getProviderListingAnalytics(providerId, req.params.id, period));
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}
