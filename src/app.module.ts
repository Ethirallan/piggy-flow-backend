import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { dataSourceOption } from './database-source.js';

@Module({
  imports: [ConfigModule.forRoot(), TypeOrmModule.forRoot(dataSourceOption)],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
