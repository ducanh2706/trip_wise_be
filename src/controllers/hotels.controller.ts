import { Request, Response, NextFunction } from 'express';
import { getHotelDetail } from '@/services/hotels.service';

export async function getHotelDetailHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json({ message: 'Invalid id' });
      return;
    }

    const detail = await getHotelDetail(id);
    if (!detail) {
      res.status(404).json({ message: 'Hotel not found' });
      return;
    }

    res.json(detail);
  } catch (err) {
    next(err);
  }
}
