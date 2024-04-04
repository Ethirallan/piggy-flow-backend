import { IsNotEmpty } from "class-validator";
import { CreateAccountDto } from "src/account/dto/create-account.dto";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateShopDto {
  id?: number;
  account?: CreateAccountDto;
  user: CreateUserDto;

  @IsNotEmpty()
  name: string;

  constructor() {

  }
}
