import { NextFunction, Request, Response } from 'express';
import {
  AdminPayoutError,
  listAdminProviderPayouts,
  reviewProviderPayoutRequests,
} from '@/services/adminPayouts.service';
import {
  ProviderApplicationError,
  listProviderApplications,
  reviewProviderApplication,
} from '@/services/providerApplications.service';
import {
  AdminListingError,
  listAdminListings,
  reviewAdminListing,
} from '@/services/adminListings.service';
import {
  AdminCancellationError,
  listAdminCancellationRequests,
  reviewCancellationRequest,
} from '@/services/adminCancellations.service';

function handleAdminError(error: unknown, res: Response, next: NextFunction): void {
  if (
    error instanceof ProviderApplicationError ||
    error instanceof AdminPayoutError ||
    error instanceof AdminListingError ||
    error instanceof AdminCancellationError
  ) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

export async function listAdminListingsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listAdminListings(req.query.status));
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function reviewAdminListingHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await reviewAdminListing({
        actorId: req.auth!.userId,
        listingId: req.params.listingId,
        decision: req.body?.decision,
        reason: req.body?.reason,
      }),
    );
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

function firstString(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstString(value[0]);
  return '';
}

export async function listProviderApplicationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listProviderApplications(req.query.status));
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function reviewProviderApplicationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await reviewProviderApplication(req.auth!.userId, firstString(req.params.userId), req.body),
    );
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function listAdminProviderPayoutsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listAdminProviderPayouts());
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function reviewProviderPayoutRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await reviewProviderPayoutRequests({
        actorId: req.auth!.userId,
        providerId: firstString(req.params.providerId),
        decision: req.body?.decision,
      }),
    );
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function listAdminCancellationRequestsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listAdminCancellationRequests());
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function reviewCancellationRequestHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await reviewCancellationRequest({
        actorId: req.auth!.userId,
        bookingItemId: firstString(req.params.bookingItemId),
        decision: req.body?.decision,
      }),
    );
  } catch (error) {
    handleAdminError(error, res, next);
  }
}
