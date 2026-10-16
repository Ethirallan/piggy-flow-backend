import { UserResponseDto } from '../../users/dto/user-response.dto.js';
import { TokenPairDto } from './token-pair.dto.js';

export class AuthResponseDto extends TokenPairDto {
  user: UserResponseDto;
}
