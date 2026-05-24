import { NextFunction, Request, Response } from 'express';
import {
  CheckoutError,
  completeCheckout,
  getCheckoutSummary,
} from '@/services/checkout.service';

function handleCheckoutError(
  error: unknown,
  res: Response,
  next: NextFunction,
): void {
  if (error instanceof CheckoutError) {
    res.status(error.status).json({ message: error.message });
    return;
  }
  next(error);
}

export async function getCheckoutSummaryHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(
      await getCheckoutSummary({
        userId: req.auth!.userId,
        hotelId: req.query.hotelId,
        roomId: req.query.roomId,
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        guests: req.query.guests,
      }),
    );
  } catch (error) {
    handleCheckoutError(error, res, next);
  }
}

export async function completeCheckoutHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body ?? {};
    res.status(201).json(
      await completeCheckout({
        userId: req.auth!.userId,
        hotelId: body.hotelId,
        roomId: body.roomId,
        startDate: body.startDate,
        endDate: body.endDate,
        guests: body.guests,
        paymentMethod: body.paymentMethod,
        usePoints: body.usePoints,
        agreeToTerms: body.agreeToTerms,
      }),
    );
  } catch (error) {
    handleCheckoutError(error, res, next);
  }
}
