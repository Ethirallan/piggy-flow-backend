import type { AccountMember } from '../account-member.entity.js';
import type { Account } from '../account.entity.js';
import { AccountResponseDto } from './account-response.dto.js';
import { MemberResponseDto } from './member-response.dto.js';

export class AccountDetailsDto extends AccountResponseDto {
  /** In the order they joined. */
  members: MemberResponseDto[];

  /** `members` must have `user` loaded. */
  static withMembers(
    account: Account,
    members: AccountMember[],
  ): AccountDetailsDto {
    return Object.assign(
      new AccountDetailsDto(),
      AccountResponseDto.from(account),
      {
        members: members.map((member) =>
          MemberResponseDto.from(member, member.user!),
        ),
      },
    );
  }
}
