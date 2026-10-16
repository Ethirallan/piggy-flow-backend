import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { EmailTakenError } from './email-taken.error.js';
import { normalizeEmail } from './normalize-email.js';
import { User } from './user.entity.js';

const UNIQUE_VIOLATION = '23505';

export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  findById(id: string): Promise<User | null> {
    return this.users.findOneBy({ id });
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findOneBy({ email: normalizeEmail(email) });
  }

  async create(input: CreateUserInput): Promise<User> {
    const user = this.users.create({
      email: normalizeEmail(input.email),
      displayName: input.displayName.trim(),
      passwordHash: input.passwordHash,
    });
    try {
      return await this.users.save(user);
    } catch (error) {
      // The unique index is the final check, so a racing duplicate is a 409, not a 500.
      if (isUniqueViolation(error)) {
        throw new EmailTakenError();
      }
      throw error;
    }
  }

  async updateDisplayName(
    id: string,
    displayName: string,
  ): Promise<User | null> {
    await this.users.update({ id }, { displayName: displayName.trim() });
    return this.findById(id);
  }

  async updatePasswordHash(id: string, passwordHash: string): Promise<void> {
    await this.users.update({ id }, { passwordHash });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: unknown }).code === UNIQUE_VIOLATION
  );
}
