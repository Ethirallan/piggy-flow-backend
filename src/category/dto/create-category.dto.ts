import { IsNotEmpty } from "class-validator";
import { IsSingleEmoji } from "src/shared/is-singe-emoji-validator";
import { CreateUserDto } from "src/user/dto/create-user.dto";

export class CreateCategoryDto {
  id: number;

  user: CreateUserDto;

  @IsNotEmpty()
  name: string;

  @IsSingleEmoji()
  emoji: string;

  constructor() {}
}
