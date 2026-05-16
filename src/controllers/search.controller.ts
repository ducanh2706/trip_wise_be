import { NextFunction, Request, Response } from 'express';
import { getSearchData } from '@/services/search.service';

export async function getSearchHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const query = typeof req.query.query === 'string' ? req.query.query : '';
    const category =
      typeof req.query.category === 'string' ? req.query.category : 'all';

    const data = await getSearchData({
      query,
      category,
    });

    res.json(data);
  } catch (error) {
    next(error);
  }
}
