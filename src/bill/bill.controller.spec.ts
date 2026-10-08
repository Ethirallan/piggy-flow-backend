import { Test, TestingModule } from '@nestjs/testing';
import { BillController } from './bill.controller';
import { BillService } from './bill.service';

// sharp's native binary is not needed to construct the controller (and may be
// missing on dev machines), so replace it.
jest.mock('sharp', () => jest.fn());

describe('BillController', () => {
  let controller: BillController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BillController],
      providers: [
        { provide: BillService, useValue: {} },
      ],
    }).compile();

    controller = module.get<BillController>(BillController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
