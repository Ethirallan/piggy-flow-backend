import { IsNotEmpty } from "class-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateAccountDto {
  id: number;
  users: CreateUserDto[];

  @IsNotEmpty()
  name: string;

  constructor() {}
}
