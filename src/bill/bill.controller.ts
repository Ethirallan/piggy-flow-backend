import { Controller, Get, Post, Body, Patch, Param, Delete, ParseIntPipe, Req, UseInterceptors, UploadedFiles, Res } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { BillService } from './bill.service';
import { CreateBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { CreateBillPhotoDto } from './dto/create-bill-photo.dto';
import { diskStorage } from 'multer';
import { encode } from 'blurhash';
import * as sharp from 'sharp';
import * as uuid from 'uuid-by-string';

const re = /(?:\.([^.]+))?$/;

const encodeImageToBlurhash = (path: string): Promise<string> => new Promise((resolve, reject) => {
  sharp(path)
    .rotate()
    .raw()
    .ensureAlpha()
    .resize(32, 32, { fit: "inside" })
    .toBuffer((err, buffer, { width, height }) => {
      if (err) return reject(err);
      resolve(encode(new Uint8ClampedArray(buffer), width, height, 7, 7));
    });
});

@Controller('bill')
export class BillController {
  constructor(private readonly billService: BillService) {}

  @Get('getBillsByUser')
  async getBillsByUserId(@Req() req: any) {
    return this.billService.getBillsByUserId(req.user.id);
  }

  @Get('getBillDetails/:id')
  getBillDetails(@Param('id', ParseIntPipe) id: number) {
    return this.billService.getBillById(id);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateBillDto: UpdateBillDto) {
    return this.billService.update(id, updateBillDto);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.billService.remove(id);
  }

  @Post()
  @UseInterceptors(FilesInterceptor('files', null, {
    storage: diskStorage({
      destination: './uploads',
      filename: (req, file, cb) => {
        var fileExtension = re.exec(file.originalname)[1];

        const name: string = uuid(file.originalname);
        const path: string = name + '.' + fileExtension;

        cb(null, path);
      },
    }),
    fileFilter: (req, file, cb) => {
      if (!file.originalname.match(/\.(jpg|png|jpeg|gif)$/)) {
        return cb(null, false);
      }
      return cb(null, true);
    },
  }))
  async addNewBill(@Body() data: any, @Req() req: any, @UploadedFiles() files: Array<Express.Multer.File>) {
    if (files) {
      data = JSON.parse(data.body);
    }

    let createBillDto: CreateBillDto = new CreateBillDto();
    createBillDto = Object.assign(createBillDto, data);
    createBillDto.user = req['user'];
    const bill = await this.billService.create(createBillDto);
    if (files) {
      for (let file of files) {
          let newPhoto = new CreateBillPhotoDto();
          newPhoto.name = file.originalname;
          newPhoto.path = file.filename;
          newPhoto.blurhash = await encodeImageToBlurhash(file.path);
          newPhoto.bill = bill;
          await this.billService.addPhoto(newPhoto);
      };
    }

    return this.billService.getBillById(bill.id);
  }

  @Get('getPhoto/:path')
  async getPhoto(@Param('path') path: string, @Res() res: any) {
    const photo = await this.billService.getPhoto(path);
    res.sendFile(photo.path, { root: './uploads' });
  }
}
