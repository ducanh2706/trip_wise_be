import { Request, Response, NextFunction } from 'express';
import { getActivityCatalog } from '@/services/activities.service';

export async function getActivitiesHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const category =
      typeof req.query.category === 'string' ? req.query.category : undefined;
    res.json(await getActivityCatalog(category));
  } catch (err) {
    next(err);
  }
}
