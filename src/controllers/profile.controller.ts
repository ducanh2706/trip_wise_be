import { NextFunction, Request, Response } from 'express';
import { getProfile } from '@/services/profile.service';

export async function getProfileHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getProfile());
  } catch (error) {
    next(error);
  }
}
