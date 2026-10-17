import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateBills1792273329243 implements MigrationInterface {
  name = 'CreateBills1792273329243';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "bills" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "account_id" uuid NOT NULL,
                "date" TIMESTAMP WITH TIME ZONE NOT NULL,
                "price_cents" integer NOT NULL,
                "shop_id" uuid,
                "category_id" uuid,
                "comment" character varying(1000),
                "created_by" uuid,
                "updated_by" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_bills_price_cents_not_zero" CHECK ("price_cents" <> 0),
                CONSTRAINT "PK_a56215dfcb525755ec832cc80b7" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_bills_shop_id" ON "bills" ("shop_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_bills_category_id" ON "bills" ("category_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_bills_account_date_id" ON "bills" ("account_id", "date", "id")
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD CONSTRAINT "FK_bills_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD CONSTRAINT "FK_bills_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD CONSTRAINT "FK_bills_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD CONSTRAINT "FK_8e991e9b703fb6fc7a3c73a8c3b" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD CONSTRAINT "FK_ae47f64567c586339ccd8eecb86" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "bills" DROP CONSTRAINT "FK_ae47f64567c586339ccd8eecb86"
        `);
    await queryRunner.query(`
            ALTER TABLE "bills" DROP CONSTRAINT "FK_8e991e9b703fb6fc7a3c73a8c3b"
        `);
    await queryRunner.query(`
            ALTER TABLE "bills" DROP CONSTRAINT "FK_bills_category"
        `);
    await queryRunner.query(`
            ALTER TABLE "bills" DROP CONSTRAINT "FK_bills_shop"
        `);
    await queryRunner.query(`
            ALTER TABLE "bills" DROP CONSTRAINT "FK_bills_account"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bills_account_date_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bills_category_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bills_shop_id"
        `);
    await queryRunner.query(`
            DROP TABLE "bills"
        `);
  }
}
