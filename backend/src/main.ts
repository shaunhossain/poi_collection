import { NestFactory } from '@nestjs/core';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    credentials: true,
  });

  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));

  const port = parseInt(process.env.PORT || '4000', 10);
  await app.listen(port, '0.0.0.0');
  console.log(`NestJS POI Extraction API listening on port ${port}`);
}

bootstrap();
