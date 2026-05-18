import { NextFunction, Request, Response } from 'express';
import {
  getProfile,
  ProfileError,
  updateProfileAvatar,
} from '@/services/profile.service';

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

export async function updateProfileAvatarHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const publicBaseUrl = `${req.protocol}://${req.get('host')}`;
    res.json(
      await updateProfileAvatar(req.auth!.userId, req.body, publicBaseUrl),
    );
  } catch (error) {
    if (error instanceof ProfileError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}
