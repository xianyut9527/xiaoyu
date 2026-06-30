import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

/**
 * Initial schema for the 幕僚 backend.
 *
 * Creates 5 tables (users, conversations, messages, analysis_requests,
 * analysis_results) plus the PostgreSQL `message_role_enum` type used
 * by `messages.role`.
 *
 * Hand-written instead of generated so that:
 *  - column defaults (gen_random_uuid, now()) are explicit and
 *    reproducible, and
 *  - foreign key ON DELETE behaviour is intentionally CASCADE
 *    (deleting a user removes their conversations / analysis data,
 *    deleting a conversation removes its messages, etc.).
 *
 * Naming convention reminder: TypeORM derives the migration class
 * name as `<camelCase(file name, true)><timestamp>`. With timestamp
 * 20260629000001 the class is `InitSchema20260629000001`.
 */
export class InitSchema20260629000001 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. users --------------------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'users',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'deviceId', type: 'varchar', length: '64', isUnique: true },
          {
            name: 'authType',
            type: 'varchar',
            length: '20',
            default: "'anonymous'",
          },
          {
            name: 'email',
            type: 'varchar',
            length: '255',
            isNullable: true,
            isUnique: true,
          },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );

    // 2. conversations ------------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'conversations',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'title',
            type: 'varchar',
            length: '200',
            default: "'新会话'",
          },
          { name: 'summary', type: 'text', isNullable: true },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
          { name: 'updatedAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'conversations',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createIndex(
      'conversations',
      new TableIndex({
        name: 'idx_conversations_userId',
        columnNames: ['userId'],
      }),
    );

    // 3. messages -----------------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'messages',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          {
            name: 'role',
            type: 'enum',
            enum: ['user', 'assistant', 'system'],
          },
          { name: 'content', type: 'text', isNullable: false },
          { name: 'conversationId', type: 'uuid', isNullable: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'messages',
      new TableForeignKey({
        columnNames: ['conversationId'],
        referencedTableName: 'conversations',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createIndex(
      'messages',
      new TableIndex({
        name: 'idx_messages_conversationId',
        columnNames: ['conversationId'],
      }),
    );
    // Composite index supports the typical "load N most recent messages
    // for a conversation" query used by chat history pagination.
    await queryRunner.createIndex(
      'messages',
      new TableIndex({
        name: 'idx_messages_conversation_created',
        columnNames: ['conversationId', 'createdAt'],
      }),
    );

    // 4. analysis_requests --------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'analysis_requests',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'templateType', type: 'varchar', length: '50' },
          { name: 'input', type: 'jsonb' },
          { name: 'userId', type: 'uuid', isNullable: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'analysis_requests',
      new TableForeignKey({
        columnNames: ['userId'],
        referencedTableName: 'users',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createIndex(
      'analysis_requests',
      new TableIndex({
        name: 'idx_analysis_requests_userId',
        columnNames: ['userId'],
      }),
    );

    // 5. analysis_results ---------------------------------------------------
    await queryRunner.createTable(
      new Table({
        name: 'analysis_results',
        columns: [
          {
            name: 'id',
            type: 'uuid',
            isPrimary: true,
            default: 'gen_random_uuid()',
          },
          { name: 'content', type: 'text' },
          { name: 'providerOutputs', type: 'text', isNullable: true },
          { name: 'judgeModel', type: 'varchar', length: '50' },
          { name: 'requestId', type: 'uuid', isNullable: false },
          { name: 'createdAt', type: 'timestamptz', default: 'now()' },
        ],
      }),
      true,
    );
    await queryRunner.createForeignKey(
      'analysis_results',
      new TableForeignKey({
        columnNames: ['requestId'],
        referencedTableName: 'analysis_requests',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
    await queryRunner.createIndex(
      'analysis_results',
      new TableIndex({
        name: 'idx_analysis_results_requestId',
        columnNames: ['requestId'],
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Drop in reverse dependency order. `true` cascades to drop FKs
    // and indexes belonging to each table.
    await queryRunner.dropTable('analysis_results', true);
    await queryRunner.dropTable('analysis_requests', true);
    await queryRunner.dropTable('messages', true);
    await queryRunner.dropTable('conversations', true);
    await queryRunner.dropTable('users', true);

    // TypeORM's dropTable does not drop the PostgreSQL enum type
    // automatically. The name follows the
    // `<tableName>_<columnName>_enum` convention used by
    // PostgresQueryRunner.buildEnumName.
    await queryRunner.query(`DROP TYPE IF EXISTS "messages_role_enum"`);
  }
}
