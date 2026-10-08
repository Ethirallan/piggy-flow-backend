import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BillService } from './bill.service';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';

describe('BillService', () => {
  let service: BillService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BillService,
        { provide: getRepositoryToken(Bill), useValue: {} },
        { provide: getRepositoryToken(BillPhoto), useValue: {} },
      ],
    }).compile();

    service = module.get<BillService>(BillService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
