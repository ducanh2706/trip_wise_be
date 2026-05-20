import { NextFunction, Request, Response } from 'express';
import { getProviderDashboard } from '@/services/providerDashboard.service';

export async function getProviderDashboardHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getProviderDashboard(req.auth!.userId));
  } catch (error) {
    next(error);
  }
}
