import { Router } from 'express';
import {
  createConversationHandler,
  createConversationFromOrderHandler,
  getConversationHandler,
  listConversationsHandler,
  markConversationReadHandler,
  sendMessageHandler,
} from '@/controllers/directMessages.controller';

const router = Router();

router.get('/conversations', listConversationsHandler);
router.post('/conversations/from-order', createConversationFromOrderHandler);
router.post('/conversations', createConversationHandler);
router.get('/conversations/:id', getConversationHandler);
router.post('/conversations/:id/messages', sendMessageHandler);
router.post('/conversations/:id/read', markConversationReadHandler);

export default router;
