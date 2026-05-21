import { NextFunction, Request, Response } from 'express';
import {
  ProviderListingError,
  createProviderListing,
  deleteProviderListing,
  getProviderListingAnalytics,
  getProviderListingDetail,
  listProviderListings,
  updateProviderListing,
} from '@/services/providerListings.service';

function handleProviderListingError(error: unknown, res: Response, next: NextFunction): void {
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
    res.json(
      await listProviderListings({
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
    res.json(await getProviderListingDetail(req.params.id));
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
    const publicBaseUrl = `${req.protocol}://${req.get('host')}`;
    res.status(201).json(await createProviderListing(req.body ?? {}, publicBaseUrl));
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
    res.json(await updateProviderListing(req.params.id, req.body ?? {}));
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
    res.json(await deleteProviderListing(req.params.id));
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
    const period = typeof req.query.period === 'string' ? req.query.period : undefined;
    res.json(await getProviderListingAnalytics(req.params.id, period));
  } catch (error) {
    handleProviderListingError(error, res, next);
  }
}
