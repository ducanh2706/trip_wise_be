import { Request, Response, NextFunction } from 'express';
import {
  getInventoryOverview,
  updateInventoryDay,
  updatePricingRules,
  InventoryError,
} from '@/services/inventory.service';

function handleInventoryError(
  err: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (err instanceof InventoryError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  next(err);
}

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

export async function updateDayHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { date, available, price } = req.body ?? {};
    res.json(await updateInventoryDay({ date, available, price }));
  } catch (err) {
    handleInventoryError(err, res, next);
  }
}

export async function updateRulesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body ?? {};
    const month = typeof body.month === 'string' ? body.month : undefined;
    res.json(await updatePricingRules(body, month));
  } catch (err) {
    handleInventoryError(err, res, next);
  }
}
