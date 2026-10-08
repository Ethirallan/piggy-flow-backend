import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { BillController } from './bill.controller';
import { BillService } from './bill.service';

// sharp's native binary is not needed to construct the controller (and may be
// missing on dev machines), so replace it.
jest.mock('sharp', () => jest.fn());

describe('BillController', () => {
  let controller: BillController;
  const service = {
    getOwnedBill: jest.fn(),
    removeOwned: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillController],
      providers: [{ provide: BillService, useValue: service }],
    }).compile();

    controller = module.get<BillController>(BillController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('getBillDetails passes the request user id', async () => {
    service.getOwnedBill.mockResolvedValue({ id: 5 });
    await expect(controller.getBillDetails(5, { user: { id: 7 } })).resolves.toEqual({ id: 5 });
    expect(service.getOwnedBill).toHaveBeenCalledWith(5, 7);
  });

  it('getBillDetails returns 404 when there is no request user', async () => {
    await expect(controller.getBillDetails(5, { user: null })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(service.getOwnedBill).not.toHaveBeenCalled();
  });

  it('remove passes the request user id and returns the delete result', async () => {
    service.removeOwned.mockResolvedValue({ affected: 1 });
    await expect(controller.remove(5, { user: { id: 7 } })).resolves.toEqual({ affected: 1 });
    expect(service.removeOwned).toHaveBeenCalledWith(5, 7);
  });

  it('remove returns 404 when there is no request user', async () => {
    await expect(controller.remove(5, { user: undefined })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    expect(service.removeOwned).not.toHaveBeenCalled();
  });
});
