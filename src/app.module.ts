import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { validateEnv } from './config/env.validation.js';
import { dataSourceOption } from './database-source.js';
import { buildLoggerParams } from './logging/logger-params.js';
import { UsersModule } from './users/users.module.js';
import { AccountsModule } from './accounts/accounts.module.js';
import { ShopsModule } from './shops/shops.module.js';
import { CategoriesModule } from './categories/categories.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot(buildLoggerParams()),
    TypeOrmModule.forRoot({
      ...dataSourceOption,
      entities: [],
      autoLoadEntities: true,
    }),
    UsersModule,
    AccountsModule,
    ShopsModule,
    CategoriesModule,
    AuthModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
