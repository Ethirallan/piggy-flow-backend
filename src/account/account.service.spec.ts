import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AccountService } from './account.service';
import { Account } from './entities/account.entity';

describe('AccountService', () => {
  let service: AccountService;
  const repo = { findOne: jest.fn(), update: jest.fn(), delete: jest.fn() };

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

  it('removeMember deletes for a member', async () => {
    repo.findOne.mockResolvedValue({ id: 3, users: [{ id: 7 }] });
    repo.delete.mockResolvedValue({ affected: 1 });
    await service.removeMember(3, 7);
    expect(repo.delete).toHaveBeenCalledWith(3);
  });
});
