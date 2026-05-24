import { Router } from 'express';
import {
  deleteProfileVerificationDocumentHandler,
  getProfileHandler,
  updateProfileAvatarHandler,
  updateProfileVerificationDocumentHandler,
} from '@/controllers/profile.controller';

const router = Router();

router.get('/', getProfileHandler);
router.patch('/avatar', updateProfileAvatarHandler);
router.patch('/verification/:documentType', updateProfileVerificationDocumentHandler);
router.delete('/verification/:documentType', deleteProfileVerificationDocumentHandler);

export default router;
