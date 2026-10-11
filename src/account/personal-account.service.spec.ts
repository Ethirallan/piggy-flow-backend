import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Account } from './entities/account.entity';
import { PersonalAccountService } from './personal-account.service';

describe('PersonalAccountService', () => {
  let service: PersonalAccountService;
  const qb = { innerJoin: jest.fn(), where: jest.fn(), getOne: jest.fn() };
  const repo = { createQueryBuilder: jest.fn(), save: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    repo.createQueryBuilder.mockReturnValue(qb);
    qb.innerJoin.mockReturnValue(qb);
    qb.where.mockReturnValue(qb);
    const module: TestingModule = await Test.createTestingModule({
      providers: [PersonalAccountService, { provide: getRepositoryToken(Account), useValue: repo }],
    }).compile();
    service = module.get(PersonalAccountService);
  });

  it('returns the existing Personal account without saving', async () => {
    const personal = { id: 3, personal: true };
    qb.getOne.mockResolvedValue(personal);
    await expect(service.ensurePersonal(7)).resolves.toBe(personal);
    expect(qb.innerJoin).toHaveBeenCalledWith('account.users', 'user', 'user.id = :userId', { userId: 7 });
    expect(qb.where).toHaveBeenCalledWith('account.personal = true');
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('creates exactly one Personal account when there is none', async () => {
    qb.getOne.mockResolvedValue(null);
    repo.save.mockResolvedValue({ id: 4 });
    await expect(service.ensurePersonal(7)).resolves.toEqual({ id: 4 });
    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(repo.save).toHaveBeenCalledWith({ name: 'Personal', personal: true, users: [{ id: 7 }] });
  });
});
