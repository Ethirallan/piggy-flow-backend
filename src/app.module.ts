import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { validateEnv } from './config/env.validation.js';
import { dataSourceOption } from './database-source.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }), TypeOrmModule.forRoot(dataSourceOption), UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
