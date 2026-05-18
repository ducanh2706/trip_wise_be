import { NextFunction, Request, Response } from 'express';
import { getPaymentSuccess } from '@/services/payments.service';

export async function getPaymentSuccessHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bookingId = typeof req.params.bookingId === 'string' ? req.params.bookingId : undefined;
    const paymentId = typeof req.query.paymentId === 'string' ? req.query.paymentId : undefined;
    res.json(
      await getPaymentSuccess({
        userId: req.auth!.userId,
        bookingId,
        paymentId,
      }),
    );
  } catch (error) {
    next(error);
  }
}
