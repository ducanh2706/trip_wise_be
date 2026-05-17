import { NextFunction, Request, Response } from 'express';
import {
  getProviderFinance,
  listProviderPayoutRequests,
  requestProviderPayout,
} from '@/services/providerFinance.service';

function firstString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return firstString(value[0]);
  return undefined;
}

function numberParam(value: unknown): number | undefined {
  const raw = firstString(value);
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function getProviderFinanceHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await getProviderFinance({
      providerId: firstString(req.query.providerId),
      period: firstString(req.query.period),
      query: firstString(req.query.query) ?? firstString(req.query.q),
      status: firstString(req.query.status),
      limit: numberParam(req.query.limit),
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function listProviderPayoutRequestsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await listProviderPayoutRequests({
      providerId: firstString(req.query.providerId),
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function requestProviderPayoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await requestProviderPayout({
      providerId: firstString(req.body?.providerId) ?? firstString(req.query.providerId),
      amount:
        typeof req.body?.amount === 'number' ? req.body.amount : numberParam(req.query.amount),
    });
    res.status(201).json(data);
  } catch (error) {
    next(error);
  }
}
