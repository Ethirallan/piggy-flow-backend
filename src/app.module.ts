import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOption } from './database-source.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [ConfigModule.forRoot(), TypeOrmModule.forRoot(dataSourceOption), UsersModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
