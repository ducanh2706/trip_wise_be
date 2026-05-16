import { Request, Response, NextFunction } from 'express';
import { getTrips } from '@/services/trips.service';

export async function getTripsHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getTrips());
  } catch (err) {
    next(err);
  }
}
