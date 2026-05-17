import { Request, Response, NextFunction } from 'express';
import { getInventoryOverview } from '@/services/inventory.service';

export async function getInventoryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const month =
      typeof req.query.month === 'string' ? req.query.month : undefined;
    const overview = await getInventoryOverview(month);
    if (!overview) {
      res.status(404).json({ message: 'No listings for this provider' });
      return;
    }
    res.json(overview);
  } catch (err) {
    next(err);
  }
}
