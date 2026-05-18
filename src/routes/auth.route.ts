import { Router } from 'express';
import {
  googleLoginHandler,
  loginHandler,
  logoutHandler,
  meHandler,
  registerHandler,
} from '@/controllers/auth.controller';
import { requireAuth } from '@/middlewares/auth';

const router = Router();

router.post('/register', registerHandler);
router.post('/login', loginHandler);
router.post('/google', googleLoginHandler);
router.get('/me', requireAuth, meHandler);
router.post('/logout', requireAuth, logoutHandler);

export default router;
