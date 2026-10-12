import { Allow, IsNotEmpty } from "class-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateShopDto {
  id: number;
  user: CreateUserDto;

  @IsNotEmpty()
  name: string;

  /** `{ id }` of an account the user belongs to; missing means their Personal account. Checked in the service. */
  @Allow()
  account?: { id: number } | null;

  constructor() {

  }
}
