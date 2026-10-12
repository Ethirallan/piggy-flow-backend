import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { AccountService } from 'src/account/account.service';
import { assertAccountRef, assertRequiredAccountRef } from 'src/shared/account-ref';
import { pickFields } from 'src/shared/pick-fields';
import { assertSameList } from 'src/shared/same-list';
import { CreateBillPhotoDto } from './dto/create-bill-photo.dto';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { Bill } from './entities/bill.entity';
import { BillPhoto } from './entities/bill_photo.entity';
import { deletePhotoFiles, encodeImageToBlurhash } from './photo-files';

/**
 * Bill columns a client may set, on create or PATCH. Everything else in the
 * body (id, user, timestamps, photos) is ignored.
 */
const CLIENT_FIELDS = [
  'account',
  'date',
  'shop',
  'category',
  'price',
  'comment',
] as const;

/** The fields of a client body a new bill may take. The caller adds the user. */
export const pickBillFields = (body: unknown) => pickFields<CreateBillDto, (typeof CLIENT_FIELDS)[number]>(body, CLIENT_FIELDS);

@Injectable()
export class BillService {
  constructor(
    @InjectRepository(Bill)
    private billRepository: Repository<Bill>,
    @InjectRepository(BillPhoto)
    private billPhotoRepository: Repository<BillPhoto>,
    private dataSource: DataSource,
    private accountService: AccountService,
  ) {}

  /**
   * Checks a new bill before anything is saved: the account (required, and one
   * the user belongs to), then R2 against that account.
   */
  async assertNewBill(dto: CreateBillDto, userId: number) {
    await assertRequiredAccountRef(dto.account, userId, this.accountService);
    await assertSameList(this.dataSource.manager, dto.account, dto.shop, dto.category);
  }

  /**
   * Saves a bill checked by `assertNewBill`, or one the subscription cron copies
   * from a subscription (checked when it was saved).
   *
   * Only the client fields and the user are saved, never an id: a client id
   * would make `save` overwrite that bill instead of inserting a new one.
   */
  async create(createBillDto: CreateBillDto) {
    return this.billRepository.save({ ...pickBillFields(createBillDto), user: createBillDto.user });
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
    if (!bill?.account?.users?.some((u) => u.id === userId)) {
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

  /** The bills of every account the user belongs to. */
  getBillsByUserId(id: number) {
    return this.billRepository
      .createQueryBuilder('bill')
      .leftJoinAndSelect('bill.user', 'user')
      .innerJoinAndSelect('bill.account', 'account')
      .innerJoin('account.users', 'member', 'member.id = :id', { id })
      .leftJoinAndSelect('account.users', 'accountUsers') // all members, as before
      .leftJoinAndSelect('bill.shop', 'shop')
      .leftJoinAndSelect('bill.category', 'category')
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
      // Missing means unchanged; null is a 400.
      await assertAccountRef(dto.account, userId, this.accountService);

      const removeIds = [...new Set(dto.removePhotoIds ?? [])];
      const photos = bill.photos ?? [];
      if (!removeIds.every((rid) => photos.some((p) => p.id === rid))) {
        throw new BadRequestException('Unknown photo.');
      }
      removedPaths = photos
        .filter((p) => removeIds.includes(p.id))
        .map((p) => p.path);

      if (dto.account !== undefined || dto.shop !== undefined || dto.category !== undefined) {
        await assertSameList(
          this.dataSource.manager,
          dto.account !== undefined ? dto.account : bill.account,
          dto.shop !== undefined ? dto.shop : bill.shop,
          dto.category !== undefined ? dto.category : bill.category,
        );
      }

      const fields: Partial<Bill> = {};
      for (const key of CLIENT_FIELDS) {
        if (dto[key] !== undefined) (fields as any)[key] = dto[key];
      }

      const rows: Partial<BillPhoto>[] = [];
      for (const file of files) {
        let blurhash: string;
        try {
          blurhash = await encodeImageToBlurhash(file.path);
        } catch (e) {
          console.warn(`Blurhash failed for ${file.filename}:`, e);
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
      // Usually nothing was committed, but transaction() can also reject
      // after a successful COMMIT (dropped connection, release() failing), so
      // a new file is deleted only if no row references it. The removed
      // photos' files are never touched here.
      await deletePhotoFiles(newPaths, (path) =>
        this.isPhotoPathReferenced(path),
      );
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
