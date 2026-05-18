import { Router } from 'express';
import {
  getProfileHandler,
  updateProfileAvatarHandler,
} from '@/controllers/profile.controller';

const router = Router();

router.get('/', getProfileHandler);
router.patch('/avatar', updateProfileAvatarHandler);

export default router;
