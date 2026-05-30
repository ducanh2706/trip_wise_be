import { NextFunction, Request, Response } from 'express';
import { answerChat, ChatServiceError } from '@/services/chat.service';

export async function answerChatHandler(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const message = typeof req.body.message === 'string' ? req.body.message.trim() : '';
    if (!message) {
      res.status(400).json({ message: 'Message is required' });
      return;
    }

    const response = await answerChat({
      message,
      userId: req.auth?.userId,
      clientContext:
        req.body?.context && typeof req.body.context === 'object' ? req.body.context : undefined,
    });

    res.json(response);
  } catch (error) {
    if (error instanceof ChatServiceError) {
      res.status(error.status).json({ message: error.message });
      return;
    }
    next(error);
  }
}
