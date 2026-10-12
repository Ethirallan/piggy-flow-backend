import { Allow, IsNotEmpty } from "class-validator";
import { IsSingleEmoji } from "src/shared/is-singe-emoji-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateCategoryDto {
  id: number;

  user: CreateUserDto;

  @IsNotEmpty()
  name: string;

  @IsSingleEmoji()
  emoji: string;

  /** `{ id }` of an account the user belongs to; missing means their Personal account. Checked in the service. */
  @Allow()
  account?: { id: number } | null;

  constructor() {}
}
