import { PartialType } from '@nestjs/mapped-types';
import { CreateBillPhotoDto } from './create-bill-photo.dto';

export class UpdateBillPhotoDto extends PartialType(CreateBillPhotoDto) {}
