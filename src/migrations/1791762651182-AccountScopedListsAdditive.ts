import { MigrationInterface, QueryRunner } from "typeorm";

export class AccountScopedListsAdditive1791762651182 implements MigrationInterface {
    name = 'AccountScopedListsAdditive1791762651182'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`category\` ADD \`accountId\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`shop\` ADD \`accountId\` int NULL`);
        await queryRunner.query(`ALTER TABLE \`account\` ADD \`personal\` tinyint NOT NULL DEFAULT 0`);
        await queryRunner.query(`ALTER TABLE \`category\` ADD CONSTRAINT \`FK_9a3f904e7ac2ebf737fbabcc75a\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE \`shop\` ADD CONSTRAINT \`FK_59a049aef9cd9d0d399bda594dc\` FOREIGN KEY (\`accountId\`) REFERENCES \`account\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`shop\` DROP FOREIGN KEY \`FK_59a049aef9cd9d0d399bda594dc\``);
        await queryRunner.query(`ALTER TABLE \`category\` DROP FOREIGN KEY \`FK_9a3f904e7ac2ebf737fbabcc75a\``);
        await queryRunner.query(`ALTER TABLE \`account\` DROP COLUMN \`personal\``);
        await queryRunner.query(`ALTER TABLE \`shop\` DROP COLUMN \`accountId\``);
        await queryRunner.query(`ALTER TABLE \`category\` DROP COLUMN \`accountId\``);
    }

}
