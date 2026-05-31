import { NextFunction, Request, Response } from 'express';
import {
  getProviderOrders,
  lookupOrderByTicketCode,
  parseOrderStatus,
  rejectOrder,
  updateOrderStatus,
  type OrderStatus,
} from '@/services/orders.service';
import { ProviderAccessError, resolveProviderIdForUser } from '@/services/providerAccess.service';

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
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const sort = typeof req.query.sort === 'string' ? req.query.sort : undefined;

    const data = await getProviderOrders({ providerId, status, sort });
    res.json(data);
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
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

    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const order = await updateOrderStatus(id, parsedStatus, providerId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
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

    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const order = await updateOrderStatus(id, 'confirmed', providerId);
    if (!order) {
      res.status(404).json({ message: 'Order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}

export async function rejectOrderHandler(
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

    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const reason =
      typeof req.body?.reason === 'string' && req.body.reason.trim().length > 0
        ? req.body.reason.trim()
        : 'Rejected by provider';
    const order = await rejectOrder(id, providerId, reason);
    if (!order) {
      res.status(404).json({ message: 'Pending order not found' });
      return;
    }

    res.json(order);
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}

export async function lookupProviderTicketHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const providerId = await resolveProviderIdForUser(req.auth!.userId);
    const order = await lookupOrderByTicketCode({
      code: req.params.code,
      providerId,
    });
    if (!order) {
      res.status(404).json({ message: 'Ticket code was not found for your provider account' });
      return;
    }
    res.json(order);
  } catch (error) {
    if (error instanceof ProviderAccessError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}
