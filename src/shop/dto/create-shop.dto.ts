import { IsNotEmpty } from "class-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateShopDto {
  id: number;
  user: CreateUserDto;

  @IsNotEmpty()
  name: string;

  constructor() {

  }
}
