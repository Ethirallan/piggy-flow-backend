import { MigrationInterface, QueryRunner } from 'typeorm';

export class AccountScopedListsTighten1791847968558
  implements MigrationInterface
{
  name = 'AccountScopedListsTighten1791847968558';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Precheck before any DDL: MariaDB commits each ALTER on its own, so a
    // failure halfway would leave the schema half-changed.
    for (const table of ['bill', 'subscription', 'shop', 'category']) {
      const [{ n }] = await queryRunner.query(
        `SELECT COUNT(*) AS n FROM \`${table}\` WHERE accountId IS NULL`,
      );
      if (Number(n) > 0) {
        throw new Error(
          `${table} has ${n} rows without an account; run migrate:accounts --verify with the previous (BE5c) release first`,
        );
      }
    }
    await queryRunner.query(
      `ALTER TABLE \`category\` DROP FOREIGN KEY \`FK_32b856438dffdc269fa84434d9f\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` DROP FOREIGN KEY \`FK_e8f0a5cb5967931a347c31619b6\``,
    );
    await queryRunner.query(`ALTER TABLE \`category\` DROP COLUMN \`userId\``);
    await queryRunner.query(`ALTER TABLE \`shop\` DROP COLUMN \`userId\``);
    await queryRunner.query(
      `ALTER TABLE \`category\` DROP FOREIGN KEY \`FK_9a3f904e7ac2ebf737fbabcc75a\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` CHANGE \`accountId\` \`accountId\` int NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` DROP FOREIGN KEY \`FK_59a049aef9cd9d0d399bda594dc\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` CHANGE \`accountId\` \`accountId\` int NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` DROP FOREIGN KEY \`FK_1f9f865e841e7879e4f2359988d\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` CHANGE \`accountId\` \`accountId\` int NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` DROP FOREIGN KEY \`FK_8e111baa45a259873197531d38b\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` CHANGE \`accountId\` \`accountId\` int NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD CONSTRAINT \`FK_9a3f904e7ac2ebf737fbabcc75a\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` ADD CONSTRAINT \`FK_59a049aef9cd9d0d399bda594dc\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` ADD CONSTRAINT \`FK_1f9f865e841e7879e4f2359988d\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` ADD CONSTRAINT \`FK_8e111baa45a259873197531d38b\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  // Restores the old shape only: accountId becomes nullable again and
  // shop.userId / category.userId come back as empty nullable columns.
  // It does NOT restore their data; the mysqldump taken before M2 is the rollback.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`subscription\` DROP FOREIGN KEY \`FK_8e111baa45a259873197531d38b\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` DROP FOREIGN KEY \`FK_1f9f865e841e7879e4f2359988d\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` DROP FOREIGN KEY \`FK_59a049aef9cd9d0d399bda594dc\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` DROP FOREIGN KEY \`FK_9a3f904e7ac2ebf737fbabcc75a\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` CHANGE \`accountId\` \`accountId\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` ADD CONSTRAINT \`FK_8e111baa45a259873197531d38b\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` CHANGE \`accountId\` \`accountId\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` ADD CONSTRAINT \`FK_1f9f865e841e7879e4f2359988d\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` CHANGE \`accountId\` \`accountId\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` ADD CONSTRAINT \`FK_59a049aef9cd9d0d399bda594dc\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` CHANGE \`accountId\` \`accountId\` int NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD CONSTRAINT \`FK_9a3f904e7ac2ebf737fbabcc75a\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(`ALTER TABLE \`shop\` ADD \`userId\` int NULL`);
    await queryRunner.query(`ALTER TABLE \`category\` ADD \`userId\` int NULL`);
    await queryRunner.query(
      `ALTER TABLE \`shop\` ADD CONSTRAINT \`FK_e8f0a5cb5967931a347c31619b6\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD CONSTRAINT \`FK_32b856438dffdc269fa84434d9f\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }
}
