import { Transform } from "class-transformer";
import { Allow, IsNotEmpty, IsString } from "class-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateShopDto {
  id: number;
  user: CreateUserDto;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  name: string;

  /** `{ id }` of an account the user belongs to; missing means their Personal account. Checked in the service. */
  @Allow()
  account?: { id: number } | null;

  constructor() {

  }
}
