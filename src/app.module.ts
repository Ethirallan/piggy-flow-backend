import { MiddlewareConsumer, Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TypeOrmConfigService } from './shared/typeorm.service';
import { UserModule } from './user/user.module';
import { AuthMiddleware } from './middleware/auth.middleware';
import { CategoryModule } from './category/category.module';
import { ShopModule } from './shop/shop.module';
import { AccountModule } from './account/account.module';
import { BillModule } from './bill/bill.module';
import { SubscriptionModule } from './subscription/subscription.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ useClass: TypeOrmConfigService }),
    UserModule,
    CategoryModule,
    ShopModule,
    AccountModule,
    BillModule,
    SubscriptionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(AuthMiddleware)
      .exclude(
        { path: 'health', method: RequestMethod.GET },
        { path: 'bill/getPhoto/:path', method: RequestMethod.GET },
        { path: 'subscription/insertSubscriptions/:secret', method: RequestMethod.GET },
      )
      .forRoutes({
        path: '*', method: RequestMethod.ALL
      });
  }
}
