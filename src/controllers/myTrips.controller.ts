import { NextFunction, Request, Response } from 'express';
import {
  cancelMyTrip,
  getMyTripDetail,
  getMyTrips,
  MyTripsError,
} from '@/services/myTrips.service';

export async function getMyTripsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const bookingId = typeof req.query.bookingId === 'string' ? req.query.bookingId : undefined;
    res.json(await getMyTrips(req.auth!.userId, status, bookingId));
  } catch (error) {
    next(error);
  }
}

export async function getMyTripDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getMyTripDetail(req.auth!.userId, req.params.bookingItemId));
  } catch (error) {
    if (error instanceof MyTripsError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}

export async function cancelMyTripHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await cancelMyTrip(req.auth!.userId, req.params.bookingItemId));
  } catch (error) {
    if (error instanceof MyTripsError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}
