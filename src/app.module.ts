import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation.js';
import { dataSourceOption } from './database-source.js';
import { buildLoggerParams } from './logging/logger-params.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(buildLoggerParams()),
    TypeOrmModule.forRoot(dataSourceOption),
    UsersModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
