import { Request, Response, NextFunction } from 'express';
import { listHotelReviews } from '@/services/reviews.service';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

export async function listHotelReviewsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const hotelId = Number(req.params.id);
    if (!Number.isInteger(hotelId) || hotelId <= 0) {
      res.status(400).json({ message: 'Invalid id' });
      return;
    }

    const rawLimit = Number(req.query.limit);
    const rawOffset = Number(req.query.offset);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, MAX_LIMIT)
        : DEFAULT_LIMIT;
    const offset =
      Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;

    const result = await listHotelReviews(hotelId, limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
