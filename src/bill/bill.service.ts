import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBillPhotoDto } from './dto/create-bill-photo.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';

@Injectable()
export class BillService {
  constructor(
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(BillPhoto)
    private billPhotoRepository: Repository<BillPhoto>,
  ) { }

  create(createBillDto: CreateBillDto) {
    return this.billRepository.save(createBillDto);
  }

  async getBillById(id: number) {
    try {
      const bill = await this.billRepository.findOneOrFail({
        where: {
          id: id
        },
        relations: ['user', 'account', 'shop', 'category', 'photos']
      });
      return bill;
    } catch (error) {
      throw new NotFoundException();
    }
  }

  getBillsByUserId(id: number) {
    return this.billRepository.find({
      where: {
        user: {
          id: id
        }
      },
      relations: ['user', 'account', 'shop', 'category'],
      order: {
        date: "DESC",
      }
    });
  }

  update(id: number, updateBillDto: UpdateBillDto) {
    return this.billRepository.update(id, updateBillDto);
  }

  remove(id: number) {
    return this.billRepository.delete(id);
  }

  // ______________________________ photo __________________________________________
  addPhoto(createBillPhotoDto: CreateBillPhotoDto) {
    return this.billPhotoRepository.save(createBillPhotoDto);
  }

  async getPhoto(path: string) {
    try {
      const photo = await this.billPhotoRepository.findOneOrFail({
        where: {
          path: path
        },
      });
      return photo;
    } catch (error) {
      throw new NotFoundException();
    }
  }
}
