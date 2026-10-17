import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateShops1792264598155 implements MigrationInterface {
  name = 'CreateShops1792264598155';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "shops" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "account_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_3c6aaa6607d287de99815e60b96" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "shops"
            ADD CONSTRAINT "FK_5265e39b5ee98ac77f270abbcc2" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    // TypeORM can't declare an expression index; the entity marks it
    // synchronize: false so schema sync leaves it alone.
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_shops_account_id_lower_name" ON "shops" ("account_id", lower("name"))
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."UQ_shops_account_id_lower_name"
        `);
    await queryRunner.query(`
            ALTER TABLE "shops" DROP CONSTRAINT "FK_5265e39b5ee98ac77f270abbcc2"
        `);
    await queryRunner.query(`
            DROP TABLE "shops"
        `);
  }
}
