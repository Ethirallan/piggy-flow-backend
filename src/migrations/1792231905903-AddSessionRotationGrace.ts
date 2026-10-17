import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionRotationGrace1792231905903 implements MigrationInterface {
  name = 'AddSessionRotationGrace1792231905903';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "sessions"
            ADD "previous_token_hash" character varying(64)
        `);
    await queryRunner.query(`
            ALTER TABLE "sessions"
            ADD "rotated_at" TIMESTAMP WITH TIME ZONE
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "sessions" DROP COLUMN "rotated_at"
        `);
    await queryRunner.query(`
            ALTER TABLE "sessions" DROP COLUMN "previous_token_hash"
        `);
  }
}
