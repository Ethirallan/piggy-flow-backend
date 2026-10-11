import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  ParseIntPipe,
  Req,
  UseInterceptors,
  UploadedFiles,
  Res,
  NotFoundException,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { CreateBillPhotoDto } from './dto/create-bill-photo.dto';
import {
  deletePhotoFiles,
  encodeImageToBlurhash,
  photoCreateUploadOptions,
  photoUploadOptions,
  uploadsDir,
} from './photo-files';

// The same options as the global pipe in main.ts. PATCH validates by hand
// because a multipart body arrives as a JSON string in `body`.
const updateValidation = new ValidationPipe({
  whitelist: true,
  transform: true,
});

/** Deletes files multer stored for a request that is being rejected. */
const discardUploads = (files: Express.Multer.File[]) =>
  deletePhotoFiles(
    files.map((f) => f.filename).filter(Boolean),
    async () => false,
  );

@Controller('bill')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Get('getBillsByUser')
  async getBillsByUserId(@Req() req: any) {
    return this.billService.getBillsByUserId(req.user.id);
  }

  @Get('getBillDetails/:id')
  async getBillDetails(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    // req.user is null for a Firebase user without a DB row: no access.
    if (!req.user) throw new NotFoundException();
    return this.billService.getOwnedBill(id, req.user.id);
  }

  @Patch(':id')
  @UseInterceptors(FilesInterceptor('files', null, photoUploadOptions))
  async update(
    @Param('id') rawId: string,
    @Body() data: any,
    @Req() req: any,
    @UploadedFiles() uploaded: Array<Express.Multer.File>,
  ) {
    const files = uploaded ?? [];
    let id: number;
    let dto: UpdateBillDto;
    try {
      id = await new ParseIntPipe().transform(rawId, {
        type: 'param',
        data: 'id',
      });
      if (!req.user) throw new NotFoundException();
      let plain = data;
      if (typeof data?.body === 'string') {
        try {
          plain = JSON.parse(data.body);
        } catch {
          throw new BadRequestException('Invalid body.');
        }
      }
      dto = await updateValidation.transform(plain ?? {}, {
        type: 'body',
        metatype: UpdateBillDto,
      });
    } catch (e) {
      await discardUploads(files);
      throw e;
    }
    return this.billService.updateWithPhotos(id, req.user.id, dto, files);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: any) {
    if (!req.user) throw new NotFoundException();
    return this.billService.removeOwned(id, req.user.id);
  }

  @Post()
  @UseInterceptors(FilesInterceptor('files', null, photoCreateUploadOptions))
  async addNewBill(
    @Body() data: any,
    @Req() req: any,
    @UploadedFiles() files: Array<Express.Multer.File>,
  ) {
    let bill: { id: number };
    try {
      if (!req.user) throw new NotFoundException();
      if (files) {
        try {
          data = JSON.parse(data.body);
        } catch {
          throw new BadRequestException('Invalid body.');
        }
      }
      const createBillDto = Object.assign(new CreateBillDto(), data);
      createBillDto.user = req.user;
      await this.billService.assertTargetAccount(createBillDto.account, req.user.id);
      bill = await this.billService.create(createBillDto);
    } catch (e) {
      // Nothing references the uploads yet.
      await discardUploads(files ?? []);
      throw e;
    }
    try {
      for (const file of files ?? []) {
        const newPhoto = new CreateBillPhotoDto();
        newPhoto.name = file.originalname;
        newPhoto.path = file.filename;
        try {
          newPhoto.blurhash = await encodeImageToBlurhash(file.path);
        } catch (e) {
          console.warn(`Blurhash failed for ${file.filename}:`, e);
          newPhoto.blurhash = '000000';
        }
        newPhoto.bill = bill as any;
        await this.billService.addPhoto(newPhoto);
      }
    } catch (e) {
      // The bill and some photo rows are saved: delete only unreferenced files.
      await deletePhotoFiles(
        (files ?? []).map((f) => f.filename).filter(Boolean),
        (path) => this.billService.isPhotoPathReferenced(path),
      );
      throw e;
    }

    return this.billService.getBillById(bill.id);
  }

  @Get('getPhoto/:path')
  async getPhoto(@Param('path') path: string, @Res() res: any) {
    const photo = await this.billService.getPhoto(path);
    res.sendFile(photo.path, { root: uploadsDir() });
  }
}
