import { Request, Response, NextFunction } from 'express';
import {
  getWalletOverview,
  getTransactionsPage,
  topUp,
  withdraw,
  createCard,
  WalletError,
} from '@/services/wallet.service';

function handleWalletError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof WalletError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  next(err);
}

export async function getWalletHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const overview = await getWalletOverview(req.auth!.userId);
    if (!overview) {
      res.status(404).json({ message: 'Wallet not found' });
      return;
    }
    res.json(overview);
  } catch (err) {
    next(err);
  }
}

export async function getTransactionsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const offset = Math.max(0, Number(req.query.offset) || 0);
    const rawLimit = Number(req.query.limit) || 10;
    const limit = Math.min(Math.max(1, rawLimit), 50);
    res.json(await getTransactionsPage(req.auth!.userId, offset, limit));
  } catch (err) {
    next(err);
  }
}

export async function topUpHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { amount, cardId } = req.body ?? {};
    res.json(await topUp(req.auth!.userId, amount, cardId));
  } catch (err) {
    handleWalletError(err, res, next);
  }
}

export async function withdrawHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { amount, cardId } = req.body ?? {};
    res.json(await withdraw(req.auth!.userId, amount, cardId));
  } catch (err) {
    handleWalletError(err, res, next);
  }
}

export async function createCardHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { brand, last4, holderName } = req.body ?? {};
    res.status(201).json(
      await createCard(req.auth!.userId, { brand, last4, holderName }),
    );
  } catch (err) {
    handleWalletError(err, res, next);
  }
}
