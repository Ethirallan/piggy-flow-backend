import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSubscriptions1792485170317 implements MigrationInterface {
  name = 'CreateSubscriptions1792485170317';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "subscriptions" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "account_id" uuid NOT NULL,
                "name" character varying(100),
                "price_cents" integer NOT NULL,
                "charge_day" smallint NOT NULL,
                "shop_id" uuid,
                "category_id" uuid,
                "last_charged_month" date NOT NULL,
                "created_by" uuid,
                "updated_by" uuid,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_subscriptions_last_charged_month" CHECK (
                    EXTRACT(
                        DAY
                        FROM "last_charged_month"
                    ) = 1
                ),
                CONSTRAINT "CHK_subscriptions_charge_day" CHECK (
                    "charge_day" BETWEEN 1 AND 31
                ),
                CONSTRAINT "CHK_subscriptions_price_cents_positive" CHECK ("price_cents" > 0),
                CONSTRAINT "PK_a87248d73155605cf782be9ee5e" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_subscriptions_account_id" ON "subscriptions" ("account_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_subscriptions_shop_id" ON "subscriptions" ("shop_id")
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_subscriptions_category_id" ON "subscriptions" ("category_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD "subscription_id" uuid
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_bills_subscription_id" ON "bills" ("subscription_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_subscriptions_account" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_subscriptions_shop" FOREIGN KEY ("shop_id") REFERENCES "shops"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_subscriptions_category" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_9a92203195f8367519fd64dbe09" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions"
            ADD CONSTRAINT "FK_e8b5d97abb5a91550b668a965d4" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "bills"
            ADD CONSTRAINT "FK_bills_subscription" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE
            SET NULL ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "bills" DROP CONSTRAINT "FK_bills_subscription"
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_e8b5d97abb5a91550b668a965d4"
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_9a92203195f8367519fd64dbe09"
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_subscriptions_category"
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_subscriptions_shop"
        `);
    await queryRunner.query(`
            ALTER TABLE "subscriptions" DROP CONSTRAINT "FK_subscriptions_account"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_bills_subscription_id"
        `);
    await queryRunner.query(`
            ALTER TABLE "bills" DROP COLUMN "subscription_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_subscriptions_category_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_subscriptions_shop_id"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_subscriptions_account_id"
        `);
    await queryRunner.query(`
            DROP TABLE "subscriptions"
        `);
  }
}
