import { Request, Response, NextFunction } from 'express';
import { getWalletOverview } from '@/services/wallet.service';

export async function getWalletHandler(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const overview = await getWalletOverview();
    if (!overview) {
      res.status(404).json({ message: 'Wallet not found' });
      return;
    }
    res.json(overview);
  } catch (err) {
    next(err);
  }
}
