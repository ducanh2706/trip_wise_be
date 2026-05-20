import { Router } from 'express';
import { answerChatHandler } from '@/controllers/chat.controller';

const router = Router();

router.post('/', answerChatHandler);

export default router;
