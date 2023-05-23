import { CreateBillDto } from "./create-bill.dto";

export class CreateBillPhotoDto {
  id: number;
  bill: CreateBillDto;
  blurhash: string;
  name: string;
  photo: string;
  path: string;

  constructor() {}
}
