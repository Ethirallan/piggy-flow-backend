import { IsNotEmpty, IsNumber, IsOptional } from "class-validator";
import { CreateAccountDto } from "src/account/dto/create-account.dto";
import { CreateCategoryDto } from "src/category/dto/create-category.dto";
import { CreateShopDto } from "src/shop/dto/create-shop.dto";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateSubscriptionDto {
  id: number;
  user: CreateUserDto;

  @IsOptional()
  account?: CreateAccountDto;

  @IsNumber()
  chargeDay: number;

  @IsNotEmpty()
  shop: CreateShopDto;

  @IsNotEmpty()
  category: CreateCategoryDto;

  @IsNumber({ maxDecimalPlaces: 2 })
  price: number;

  @IsOptional()
  name: string;

  constructor() { }
}
