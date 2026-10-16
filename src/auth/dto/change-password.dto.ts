import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @Length(8, 128)
  newPassword: string;
}
