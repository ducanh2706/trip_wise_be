import { NextFunction, Request, Response } from 'express';
import {
  getProviderOrders,
  parseOrderStatus,
  updateOrderStatus,
  type OrderStatus,
} from '@/services/orders.service';

const writableStatuses = new Set<OrderStatus>(['pending', 'confirmed', 'completed', 'cancelled']);

function getParamValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export async function getProviderOrdersHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId =
      typeof req.query.providerId === 'string' && req.query.providerId.trim()
        ? req.query.providerId.trim()
        : undefined;
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;

    const data = await getProviderOrders({ providerId, status, sort });
    res.json(data);
  } catch (error) {
    next(error);
  }
}

export async function updateOrderStatusHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = getParamValue(req.params.id).trim();
    if (!id) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const parsedStatus = parseOrderStatus(req.body?.status);
    if (parsedStatus === 'all' || !writableStatuses.has(parsedStatus)) {
      res.status(400).json({ message: 'Invalid status' });
      return;
    }

    const order = await updateOrderStatus(id, parsedStatus);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
}

export async function acceptOrderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const id = getParamValue(req.params.id).trim();
    if (!id) {
      res.status(400).json({ message: 'Invalid order id' });
      return;
    }

    const order = await updateOrderStatus(id, 'confirmed');
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    next(error);
  }
}
