import { Request, Response, NextFunction } from 'express';
import { getTrips, addTripItem, TripError } from '@/services/trips.service';

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

export async function addTripItemHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tripId = String(req.params.id);
    const { dayIndex, activityId } = req.body ?? {};
    const updated = await addTripItem(
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
