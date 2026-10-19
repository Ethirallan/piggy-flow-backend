import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBillPhotos1792441469581 implements MigrationInterface {
  name = 'CreateBillPhotos1792441469581';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "bill_photos" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "bill_id" uuid NOT NULL,
                "name" character varying(255) NOT NULL,
                "width" integer NOT NULL,
                "height" integer NOT NULL,
                "size_bytes" integer NOT NULL,
                "created_by" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_a7fe8ecba3bb320b7d3d39d3e06" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_bill_photos_bill_id" ON "bill_photos" ("bill_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "bill_photos"
            ADD CONSTRAINT "FK_1856278e14c696051fbef76165e" FOREIGN KEY ("bill_id") REFERENCES "bills"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bill_photos"
            ADD CONSTRAINT "FK_7cf8fb86c66541b2a3c908b8a23" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "bill_photos" DROP CONSTRAINT "FK_7cf8fb86c66541b2a3c908b8a23"
        `);
    await queryRunner.query(`
            ALTER TABLE "bill_photos" DROP CONSTRAINT "FK_1856278e14c696051fbef76165e"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bill_photos_bill_id"
        `);
    await queryRunner.query(`
            DROP TABLE "bill_photos"
        `);
  }
}
