import { Router } from 'express';
import {
  getProfileHandler,
  updateProfileAvatarHandler,
  updateProfileVerificationDocumentHandler,
} from '@/controllers/profile.controller';

const router = Router();

router.get('/', getProfileHandler);
router.patch('/avatar', updateProfileAvatarHandler);
router.patch('/verification/:documentType', updateProfileVerificationDocumentHandler);

export default router;
