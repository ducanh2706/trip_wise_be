import { Request, Response, NextFunction } from 'express';
import { getTrips, createTrip, addTripItem, TripError } from '@/services/trips.service';

export async function getTripsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getTrips(req.auth!.userId));
  } catch (err) {
    next(err);
  }
}

export async function createTripHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const trip = await createTrip(req.auth!.userId, req.body ?? {});
    res.status(201).json(trip);
  } catch (err) {
    if (err instanceof TripError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    next(err);
  }
}

export async function addTripItemHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tripId = String(req.params.id);
    const { dayIndex, activityId } = req.body ?? {};
    const updated = await addTripItem(
      req.auth!.userId,
      tripId,
      Number(dayIndex),
      Number(activityId),
    );
    res.status(201).json(updated);
  } catch (err) {
    if (err instanceof TripError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    next(err);
  }
}
