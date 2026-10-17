import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAccounts1792238370710 implements MigrationInterface {
  name = 'CreateAccounts1792238370710';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "accounts" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "name" character varying(100) NOT NULL,
                "is_personal" boolean NOT NULL DEFAULT false,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_5a7a02c20412299d198e097a8fe" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            CREATE TABLE "account_members" (
                "account_id" uuid NOT NULL,
                "user_id" uuid NOT NULL,
                "joined_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_64ad7a24bdd270694561759c6b7" PRIMARY KEY ("account_id", "user_id")
            )
        `);
    await queryRunner.query(`
            CREATE INDEX "IDX_28435cf7197859fae41e0be356" ON "account_members" ("user_id")
        `);
    await queryRunner.query(`
            ALTER TABLE "account_members"
            ADD CONSTRAINT "FK_9beab0863ddc39238af9b8b95dd" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    await queryRunner.query(`
            ALTER TABLE "account_members"
            ADD CONSTRAINT "FK_28435cf7197859fae41e0be3560" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "account_members" DROP CONSTRAINT "FK_28435cf7197859fae41e0be3560"
        `);
    await queryRunner.query(`
            ALTER TABLE "account_members" DROP CONSTRAINT "FK_9beab0863ddc39238af9b8b95dd"
        `);
    await queryRunner.query(`
            DROP INDEX "public"."IDX_28435cf7197859fae41e0be356"
        `);
    await queryRunner.query(`
            DROP TABLE "account_members"
        `);
    await queryRunner.query(`
            DROP TABLE "accounts"
        `);
  }
}
