import { MigrationInterface, QueryRunner } from 'typeorm';

export class Baseline1791761595347 implements MigrationInterface {
  name = 'Baseline1791761595347';

  public async up(queryRunner: QueryRunner): Promise<void> {
    if (await queryRunner.hasTable('user')) return; // existing databases (production) already have this schema
    await queryRunner.query(
      `CREATE TABLE \`category\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`emoji\` varchar(20) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`lastUpdate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`userId\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`shop\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`lastUpdate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`userId\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`bill_photo\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` text CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`path\` text CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`blurhash\` text CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`billId\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`bill\` (\`id\` int NOT NULL AUTO_INCREMENT, \`date\` datetime NOT NULL, \`price\` decimal(10,2) NOT NULL, \`comment\` text CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`lastUpdate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`userId\` int NULL, \`accountId\` int NULL, \`shopId\` int NULL, \`categoryId\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`account\` (\`id\` int NOT NULL AUTO_INCREMENT, \`name\` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`lastUpdate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`subscription\` (\`id\` int NOT NULL AUTO_INCREMENT, \`chargeDay\` int NOT NULL, \`price\` decimal(10,2) NOT NULL, \`name\` text CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`lastUpdate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`userId\` int NULL, \`accountId\` int NULL, \`shopId\` int NULL, \`categoryId\` int NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`user\` (\`id\` int NOT NULL AUTO_INCREMENT, \`uid\` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`email\` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`displayName\` varchar(255) CHARACTER SET "utf8mb4" COLLATE "utf8mb4_unicode_ci" NOT NULL, \`created\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`lastUpdate\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`user_accounts_account\` (\`userId\` int NOT NULL, \`accountId\` int NOT NULL, INDEX \`IDX_9ce5d7033eb172b552b3ea8cdb\` (\`userId\`), INDEX \`IDX_09f08a0193b7d06230bcadd1db\` (\`accountId\`), PRIMARY KEY (\`userId\`, \`accountId\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`category\` ADD CONSTRAINT \`FK_32b856438dffdc269fa84434d9f\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`shop\` ADD CONSTRAINT \`FK_e8f0a5cb5967931a347c31619b6\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill_photo\` ADD CONSTRAINT \`FK_f8f71e575e2181d382cf94d0ff0\` FOREIGN KEY (\`billId\`) REFERENCES \`bill\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` ADD CONSTRAINT \`FK_275fe11db713fd6f9fd62709917\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` ADD CONSTRAINT \`FK_1f9f865e841e7879e4f2359988d\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` ADD CONSTRAINT \`FK_b00d5ab8d9cffc621a58b9ad209\` FOREIGN KEY (\`shopId\`) REFERENCES \`shop\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`bill\` ADD CONSTRAINT \`FK_ddb6e5c07f27ceae2925e1fec29\` FOREIGN KEY (\`categoryId\`) REFERENCES \`category\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` ADD CONSTRAINT \`FK_cc906b4bc892b048f1b654d2aa0\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` ADD CONSTRAINT \`FK_8e111baa45a259873197531d38b\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` ADD CONSTRAINT \`FK_1d9e47187d98341a1e9addd4ef5\` FOREIGN KEY (\`shopId\`) REFERENCES \`shop\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`subscription\` ADD CONSTRAINT \`FK_0ba1800781a037cf117ae3d08d7\` FOREIGN KEY (\`categoryId\`) REFERENCES \`category\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_accounts_account\` ADD CONSTRAINT \`FK_9ce5d7033eb172b552b3ea8cdb5\` FOREIGN KEY (\`userId\`) REFERENCES \`user\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE \`user_accounts_account\` ADD CONSTRAINT \`FK_09f08a0193b7d06230bcadd1db0\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    throw new Error(
      'The baseline cannot be reverted; restore from a backup instead.',
    );
  }
}
