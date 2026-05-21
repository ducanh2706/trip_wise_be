import { NextFunction, Request, Response } from 'express';
import {
  ProviderApplicationError,
  submitProviderApplication,
} from '@/services/providerApplications.service';

function handleProviderApplicationError(error: unknown, res: Response, next: NextFunction): void {
  if (error instanceof ProviderApplicationError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

export async function submitProviderApplicationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(await submitProviderApplication(req.auth!.userId, req.body));
  } catch (error) {
    handleProviderApplicationError(error, res, next);
  }
}
