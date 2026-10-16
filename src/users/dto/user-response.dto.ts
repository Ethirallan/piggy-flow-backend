import type { User } from '../user.entity.js';

export class UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  createdAt: Date;

  static from(user: User): UserResponseDto {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      createdAt: user.createdAt,
    };
  }
}
