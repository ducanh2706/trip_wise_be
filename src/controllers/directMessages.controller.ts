import { NextFunction, Request, Response } from 'express';
import {
  createConversationFromOrder,
  createConversation,
  DirectMessageError,
  getConversation,
  listConversations,
  markConversationRead,
  sendMessage,
} from '@/services/directMessages.service';

function handleDirectMessageError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof DirectMessageError) {
    res.status(err.status).json({ message: err.message });
    return;
  }
  next(err);
}

function getParamValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export async function listConversationsHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await listConversations(req.auth!.userId));
  } catch (err) {
    handleDirectMessageError(err, res, next);
  }
}

export async function createConversationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.status(201).json(await createConversation(req.auth!.userId, req.body));
  } catch (err) {
    handleDirectMessageError(err, res, next);
  }
}

export async function createConversationFromOrderHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const orderId =
      typeof req.body?.orderId === 'string'
        ? req.body.orderId
        : typeof req.body?.orderItemId === 'string'
          ? req.body.orderItemId
          : '';
    res.status(201).json(await createConversationFromOrder(req.auth!.userId, orderId));
  } catch (err) {
    handleDirectMessageError(err, res, next);
  }
}

export async function getConversationHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await getConversation(req.auth!.userId, getParamValue(req.params.id)));
  } catch (err) {
    handleDirectMessageError(err, res, next);
  }
}

export async function sendMessageHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res
      .status(201)
      .json(await sendMessage(req.auth!.userId, getParamValue(req.params.id), req.body));
  } catch (err) {
    handleDirectMessageError(err, res, next);
  }
}

export async function markConversationReadHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    res.json(await markConversationRead(req.auth!.userId, getParamValue(req.params.id)));
  } catch (err) {
    handleDirectMessageError(err, res, next);
  }
}
