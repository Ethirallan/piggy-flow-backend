import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import type { User } from '../users/user.entity.js';
import { UsersService } from '../users/users.service.js';
import { AccountMember } from './account-member.entity.js';
import { AccountsService } from './accounts.service.js';

@Injectable()
export class AccountMembersService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly users: UsersService,
    private readonly dataSource: DataSource,
  ) {}

  /** Adds the registered user with `email`. Any member can add others. */
  add(
    accountId: string,
    callerId: string,
    email: string,
  ): Promise<{ member: AccountMember; user: User }> {
    return this.dataSource.transaction(async (manager) => {
      const account = await this.accounts.lockForMember(
        accountId,
        callerId,
        manager,
      );
      // Checked before the lookup, so the Personal account can't be used to
      // probe which emails are registered.
      if (account.isPersonal) {
        throw new ConflictException("The Personal account can't be shared");
      }
      const user = await this.users.findByEmail(email);
      if (!user) {
        throw new NotFoundException('No user with that email');
      }
      const members = manager.getRepository(AccountMember);
      if (await members.existsBy({ accountId, userId: user.id })) {
        throw new ConflictException('Already a member');
      }
      const member = await members.save(
        members.create({ accountId, userId: user.id }),
      );
      return { member, user };
    });
  }
}
