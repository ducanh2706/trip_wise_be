import { NextFunction, Request, Response } from 'express';
import {
  AdminPayoutError,
  createTestEscrowForProvider,
  listAdminProviderPayouts,
  payProviderForPeriod,
} from '@/services/adminPayouts.service';
import {
  ProviderApplicationError,
  listProviderApplications,
  reviewProviderApplication,
} from '@/services/providerApplications.service';

function handleAdminError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ProviderApplicationError || error instanceof AdminPayoutError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
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
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listAdminProviderPayouts(req.query.period));
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function payProviderForPeriodHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await payProviderForPeriod({
        actorId: req.auth!.userId,
        providerId: firstString(req.params.providerId),
        period: req.body?.period ?? req.query.period,
      }),
    );
  } catch (error) {
    handleAdminError(error, res, next);
  }
}

export async function createTestEscrowForProviderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(
      await createTestEscrowForProvider({
        email: req.body?.email ?? 'thang3@gmail.com',
        amount: req.body?.amount ?? 100000,
      }),
    );
  } catch (error) {
    handleAdminError(error, res, next);
  }
}
