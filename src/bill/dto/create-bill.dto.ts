import { IsNotEmpty } from "class-validator";
import { CreateAccountDto } from "src/account/dto/create-account.dto";
import { CreateCategoryDto } from "src/category/dto/create-category.dto";
import { CreateShopDto } from "src/shop/dto/create-shop.dto";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateBillDto {
  id: number;
  user: CreateUserDto;
  account?: CreateAccountDto;

  @IsNotEmpty()
  date: Date;
  shop: CreateShopDto;
  category: CreateCategoryDto;

  @IsNotEmpty()
  price: number;

  comment: string;

  constructor() {}
}
