import { NextFunction, Request, Response } from 'express';
import { getProviderDashboard } from '@/services/providerDashboard.service';

export async function getProviderDashboardHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getProviderDashboard());
  } catch (error) {
    next(error);
  }
}
