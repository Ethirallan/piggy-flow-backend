import { IsNotEmpty } from "class-validator";
import { CreateBillDto } from "./create-bill.dto";

export class CreateBillPhotoDto {
  id: number;
  bill: CreateBillDto;
  blurhash: string;

  @IsNotEmpty()
  path: string;

  constructor() {}
}
