import { NextFunction, Request, Response } from 'express';
import { getProfile } from '@/services/profile.service';

export async function getProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getProfile(req.auth!.userId));
  } catch (error) {
    next(error);
  }
}
