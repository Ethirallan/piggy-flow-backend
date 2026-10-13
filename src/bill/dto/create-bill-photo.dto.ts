import { Bill } from "../entities/bill.entity";

export class CreateBillPhotoDto {
  id: number;
  bill: Pick<Bill, 'id'>;
  blurhash: string;
  name: string;
  photo: string;
  path: string;

  constructor() {}
}
