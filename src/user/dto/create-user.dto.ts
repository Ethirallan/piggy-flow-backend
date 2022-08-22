import { IsEmail, IsNotEmpty } from "class-validator";

export class CreateUserDto {
  id: number;
  uid: string;

  @IsEmail()
  email: string;

  @IsNotEmpty()
  displayName: string;

  constructor() {}
}
