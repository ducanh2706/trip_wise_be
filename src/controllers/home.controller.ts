import { NextFunction, Request, Response } from 'express';
import { getHomeData } from '@/services/home.service';

export async function getHomeHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const data = await getHomeData();
    res.json(data);
  } catch (error) {
    next(error);
  }
}
