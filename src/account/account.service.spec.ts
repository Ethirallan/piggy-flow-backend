import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountService } from './account.service';
import { Account } from './entities/account.entity';

describe('AccountService', () => {
  let service: AccountService;
  const repo = { findOne: jest.fn(), update: jest.fn(), delete: jest.fn(), createQueryBuilder: jest.fn() };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AccountService, { provide: getRepositoryToken(Account), useValue: repo }],
    }).compile();
    service = module.get<AccountService>(AccountService);
  });

  it('assertMember returns the account for a member and loads its users', async () => {
    const account = { id: 3, users: [{ id: 7 }] };
    repo.findOne.mockResolvedValue(account);
    await expect(service.assertMember(3, 7)).resolves.toBe(account);
    expect(repo.findOne).toHaveBeenCalledWith({ where: { id: 3 }, relations: ['users'] });
  });

  it('assertMember gives 404 for a stranger, a missing account and a missing user', async () => {
    repo.findOne.mockResolvedValue({ id: 3, users: [{ id: 7 }] });
    await expect(service.assertMember(3, 8)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.assertMember(3, undefined)).rejects.toBeInstanceOf(NotFoundException);
    repo.findOne.mockResolvedValue(null);
    await expect(service.assertMember(3, 7)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('create never takes id, personal or timestamps from the dto', async () => {
    (repo as any).save = jest.fn().mockResolvedValue({ id: 1 });
    await service.create({ id: 99, name: 'Home', users: [{ id: 7 }], personal: true, created: 'x', lastUpdate: 'x' } as any);
    expect((repo as any).save).toHaveBeenCalledWith({ name: 'Home', users: [{ id: 7 }] });
  });

  it('updateMember applies only the name for a member', async () => {
    repo.findOne.mockResolvedValue({ id: 3, users: [{ id: 7 }] });
    repo.update.mockResolvedValue({ affected: 1 });
    await service.updateMember(3, 7, { name: 'New', users: [{ id: 9 }], id: 99 } as any);
    expect(repo.update).toHaveBeenCalledWith(3, { name: 'New' });
  });

  it('updateMember does not update when there is no name', async () => {
    repo.findOne.mockResolvedValue({ id: 3, users: [{ id: 7 }] });
    await service.updateMember(3, 7, { users: [] } as any);
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('updateMember and removeMember give 404 for a stranger', async () => {
    repo.findOne.mockResolvedValue({ id: 3, users: [{ id: 7 }] });
    await expect(service.updateMember(3, 8, { name: 'x' } as any)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.removeMember(3, 8)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('getAccountsByUserId lists the Personal account first, then newest first', async () => {
    const calls: [string, any[]][] = [];
    const qb: any = new Proxy({}, {
      get: (_t, name: string) => (...args: any[]) => {
        calls.push([name, args]);
        return name === 'getMany' ? Promise.resolve([{ id: 1, personal: true }]) : qb;
      },
    });
    repo.createQueryBuilder.mockReturnValue(qb);
    await expect(service.getAccountsByUserId(7)).resolves.toEqual([{ id: 1, personal: true }]);
    const order = calls.filter(([name]) => name === 'orderBy' || name === 'addOrderBy');
    expect(order).toEqual([
      ['orderBy', ['account.personal', 'DESC']],
      ['addOrderBy', ['account.id', 'DESC']],
    ]);
    expect(calls).not.toContainEqual(['select', expect.anything()]);
  });

  it('removeMember gives 400 for the Personal account and deletes nothing', async () => {
    repo.findOne.mockResolvedValue({ id: 3, personal: true, users: [{ id: 7 }] });
    await expect(service.removeMember(3, 7)).rejects.toEqual(
      new BadRequestException("The Personal account can't be deleted."),
    );
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it('removeMember deletes for a member', async () => {
    repo.findOne.mockResolvedValue({ id: 3, users: [{ id: 7 }] });
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.removeMember(3, 7);
    expect(repo.delete).toHaveBeenCalledWith(3);
  });
});
