import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateBillPhotoDto } from './dto/create-bill-photo.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';
import { deletePhotoFiles } from './photo-files';

@Injectable()
export class BillService {
  constructor(
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(BillPhoto)
    private billPhotoRepository: Repository<BillPhoto>,
  ) {}

  create(createBillDto: CreateBillDto) {
    return this.billRepository.save(createBillDto);
  }

  async getBillById(id: number) {
    try {
      const bill = await this.billRepository.findOneOrFail({
        where: {
          id: id,
        },
        relations: ['user', 'account', 'shop', 'category', 'photos'],
      });
      return bill;
    } catch (error) {
      throw new NotFoundException();
    }
  }

  async getOwnedBill(id: number, userId: number): Promise<Bill> {
    if (userId === undefined || userId === null) throw new NotFoundException();
    const bill = await this.billRepository.findOne({
      where: { id },
      relations: [
        'user',
        'account',
        'account.users',
        'shop',
        'category',
        'photos',
      ],
    });
    if (
      !bill ||
      !(
        bill.user?.id === userId ||
        bill.account?.users?.some((u) => u.id === userId)
      )
    ) {
      throw new NotFoundException();
    }
    return bill;
  }

  async isPhotoPathReferenced(path: string): Promise<boolean> {
    return (await this.billPhotoRepository.count({ where: { path } })) > 0;
  }

  async removeOwned(id: number, userId: number) {
    const bill = await this.getOwnedBill(id, userId);
    const paths = (bill.photos ?? []).map((p) => p.path);
    const result = await this.billRepository.delete(id);
    await deletePhotoFiles(paths, (path) => this.isPhotoPathReferenced(path));
    return result;
  }

  getBillsByUserId(id: number) {
    return this.billRepository
      .createQueryBuilder('bill')
      .leftJoinAndSelect('bill.user', 'user')
      .leftJoinAndSelect('bill.account', 'account')
      .leftJoinAndSelect('account.users', 'accountUsers') // Many-to-many
      .leftJoinAndSelect('bill.shop', 'shop')
      .leftJoinAndSelect('bill.category', 'category')
      .where('user.id = :id', { id })
      .orWhere('accountUsers.id = :id', { id })
      .orderBy('bill.date', 'DESC')
      .getMany();
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
          path: path,
        },
      });
      return photo;
    } catch (error) {
      throw new NotFoundException();
    }
  }
}
