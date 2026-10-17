import type { User } from '../../users/user.entity.js';
import type { AccountMember } from '../account-member.entity.js';

export class MemberResponseDto {
  userId: string;
  displayName: string;
  /** Members see each other's email; it's how they were added. */
  email: string;
  joinedAt: Date;

  static from(member: AccountMember, user: User): MemberResponseDto {
    return {
      userId: member.userId,
      displayName: user.displayName,
      email: user.email,
      joinedAt: member.joinedAt,
    };
  }
}
