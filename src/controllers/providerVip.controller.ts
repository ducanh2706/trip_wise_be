import { NextFunction, Request, Response } from 'express';
import {
  getProviderVip,
  selectProviderPromotion,
  updateProviderVipAutoRenew,
  upgradeProviderToElite,
  ProviderVipError,
} from '@/services/providerVip.service';

export async function getProviderVipHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getProviderVip(req.auth!.userId));
  } catch (error) {
    next(error);
  }
}

export async function upgradeProviderToEliteHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await upgradeProviderToElite(req.auth!.userId));
  } catch (error) {
    if (error instanceof ProviderVipError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}

export async function selectProviderPromotionHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await selectProviderPromotion(req.auth!.userId, req.body?.promotionId));
  } catch (error) {
    if (error instanceof ProviderVipError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}

export async function updateProviderVipAutoRenewHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await updateProviderVipAutoRenew(req.auth!.userId, req.body?.autoRenew));
  } catch (error) {
    if (error instanceof ProviderVipError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}
