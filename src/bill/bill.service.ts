import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { CreateBillPhotoDto } from './dto/create-bill-photo.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';
import { deletePhotoFiles, encodeImageToBlurhash } from './photo-files';

/** Bill columns a PATCH may change. Everything else in the dto is ignored. */
const UPDATABLE_FIELDS = [
  'account',
  'date',
  'shop',
  'category',
  'price',
  'comment',
] as const;

@Injectable()
export class BillService {
  constructor(
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(BillPhoto)
    private billPhotoRepository: Repository<BillPhoto>,
    private dataSource: DataSource,
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

  /**
   * Updates a bill the user may see: its fields, removed photos and new
   * (already uploaded) photo files, all in one transaction.
   *
   * New files are deleted on any failure before commit. Removed photos'
   * files are deleted only after commit, and only if no row references them.
   */
  async updateWithPhotos(
    id: number,
    userId: number,
    dto: UpdateBillDto,
    files: Express.Multer.File[],
  ): Promise<Bill> {
    const newPaths = files.map((f) => f.filename).filter(Boolean);
    let removedPaths: string[];
    try {
      const bill = await this.getOwnedBill(id, userId);

      const removeIds = [...new Set(dto.removePhotoIds ?? [])];
      const photos = bill.photos ?? [];
      if (!removeIds.every((rid) => photos.some((p) => p.id === rid))) {
        throw new BadRequestException('Unknown photo.');
      }
      removedPaths = photos
        .filter((p) => removeIds.includes(p.id))
        .map((p) => p.path);

      const fields: Partial<Bill> = {};
      for (const key of UPDATABLE_FIELDS) {
        if (dto[key] !== undefined) (fields as any)[key] = dto[key];
      }

      const rows: Partial<BillPhoto>[] = [];
      for (const file of files) {
        let blurhash: string;
        try {
          blurhash = await encodeImageToBlurhash(file.path);
        } catch {
          blurhash = '000000';
        }
        rows.push({
          name: file.originalname,
          path: file.filename,
          blurhash,
          bill: { id } as Bill,
        });
      }

      await this.dataSource.transaction(async (m) => {
        if (Object.keys(fields).length > 0) {
          await m.update(Bill, id, fields);
        }
        if (removeIds.length > 0) {
          await m.delete(BillPhoto, { id: In(removeIds), bill: { id } });
        }
        if (rows.length > 0) {
          await m.insert(BillPhoto, rows);
        }
      });
    } catch (e) {
      // Nothing was committed: the new files are unreferenced. The removed
      // photos' rows still exist, so their files are left alone.
      await deletePhotoFiles(newPaths, async () => false);
      throw e;
    }

    // Committed: the new files are now referenced and must stay.
    await deletePhotoFiles(removedPaths, (path) =>
      this.isPhotoPathReferenced(path),
    );
    return this.getBillById(id);
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
