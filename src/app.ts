import express, { Application } from 'express';
import cors from 'cors';
import morgan from 'morgan';
import path from 'node:path';
import { optionalAuth } from '@/middlewares/auth';
import routes from '@/routes';
import { errorHandler, notFoundHandler } from '@/middlewares/errorHandler';

const app: Application = express();

app.use(cors());
app.use(morgan('dev'));
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true, limit: '12mb' }));
app.use(optionalAuth);
app.use('/uploads', express.static(path.resolve(process.cwd(), 'uploads')));

app.use('/api', routes);

app.use(notFoundHandler);
app.use(errorHandler);

export default app;
