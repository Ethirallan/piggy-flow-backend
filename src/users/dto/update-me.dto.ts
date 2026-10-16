import { IsString, Length } from 'class-validator';
import { Trim } from '../../common/trim.decorator.js';

export class UpdateMeDto {
  @Trim()
  @IsString()
  @Length(1, 100)
  displayName: string;
}
