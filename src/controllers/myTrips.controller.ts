import { NextFunction, Request, Response } from 'express';
import { getMyTrips } from '@/services/myTrips.service';

export async function getMyTripsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    res.json(await getMyTrips(status));
  } catch (error) {
    next(error);
  }
}
