import { Transform } from "class-transformer";
import { IsNotEmpty, IsString } from "class-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateShopDto {
  id: number;
  /** The requester, set by the controller; not stored. */
  user?: CreateUserDto;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name: string;

  /** `{ id }` of an account the user belongs to. Required; membership is checked in the service. */
  @IsNotEmpty()
  account: { id: number };

  constructor() {

  }
}
