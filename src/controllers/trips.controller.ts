import { Request, Response, NextFunction } from 'express';
import {
  getTrips,
  createTrip,
  deleteTrip,
  addTripItem,
  updateTripItemTime,
  TripError,
} from '@/services/trips.service';

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

export async function deleteTripHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tripId = String(req.params.id);
    res.json(await deleteTrip(req.auth!.userId, tripId));
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
    const updated = await addTripItem(req.auth!.userId, tripId, req.body ?? {});
    res.status(201).json(updated);
  } catch (err) {
    if (err instanceof TripError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    next(err);
  }
}

export async function updateTripItemTimeHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const tripId = String(req.params.id);
    const updated = await updateTripItemTime(req.auth!.userId, tripId, req.body ?? {});
    res.json(updated);
  } catch (err) {
    if (err instanceof TripError) {
      res.status(err.status).json({ message: err.message });
      return;
    }
    next(err);
  }
}
