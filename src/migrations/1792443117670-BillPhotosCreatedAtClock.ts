import { MigrationInterface, QueryRunner } from 'typeorm';

export class BillPhotosCreatedAtClock1792443117670 implements MigrationInterface {
  name = 'BillPhotosCreatedAtClock1792443117670';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "bill_photos"
            ALTER COLUMN "created_at"
            SET DEFAULT clock_timestamp()
        `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
            ALTER TABLE "bill_photos"
            ALTER COLUMN "created_at"
            SET DEFAULT now()
        `);
  }
}
