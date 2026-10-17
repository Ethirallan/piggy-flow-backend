import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCategories1792265904974 implements MigrationInterface {
  name = 'CreateCategories1792265904974';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            CREATE TABLE "categories" (
                "id" uuid NOT NULL DEFAULT gen_random_uuid(),
                "account_id" uuid NOT NULL,
                "name" character varying(100) NOT NULL,
                "emoji" character varying(32),
                "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
                CONSTRAINT "PK_24dbc6126a28ff948da33e97d3b" PRIMARY KEY ("id")
            )
        `);
    await queryRunner.query(`
            ALTER TABLE "categories"
            ADD CONSTRAINT "FK_8311f671b1d5897b60688aea09c" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE NO ACTION
        `);
    // TypeORM can't declare an expression index; the entity marks it
    // synchronize: false so schema sync leaves it alone.
    await queryRunner.query(`
            CREATE UNIQUE INDEX "UQ_categories_account_id_lower_name" ON "categories" ("account_id", lower("name"))
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            DROP INDEX "public"."UQ_categories_account_id_lower_name"
        `);
    await queryRunner.query(`
            ALTER TABLE "categories" DROP CONSTRAINT "FK_8311f671b1d5897b60688aea09c"
        `);
    await queryRunner.query(`
            DROP TABLE "categories"
        `);
  }
}
