# Entity Schema

> 幕僚 backend 持久层 schema 参考。所有 5 张表由初始迁移
> `apps/server/src/migrations/20260629000001-InitSchema.ts` 建出。
> PostgreSQL 17 (`gen_random_uuid()` 为内建函数，不依赖 `pgcrypto`)。

通用约定：
- 所有主键为 `uuid`，数据库默认 `gen_random_uuid()`，应用层不传。
- 所有时间字段为 `timestamptz`，数据库默认 `now()`。
- 所有外键 `ON DELETE CASCADE`：删除用户 → 删除其会话/分析；删除会话 → 删除其消息；删除分析请求 → 删除其结果。
- 表名、列名遵循 TypeORM 默认规则（沿用 entity 属性名），因此是 camelCase，建表 SQL 用双引号保留大小写。

## User

表名：`users`，对应 `apps/server/src/entities/user.entity.ts`

| 字段 | 类型 | 可空 | 默认值 | 约束 | 索引 |
|------|------|------|--------|------|------|
| id | uuid | NO | gen_random_uuid() | PK | 是 (PK) |
| deviceId | varchar(64) | NO | — | UNIQUE | 是 (unique) |
| authType | varchar(20) | NO | 'anonymous' | CHECK 由应用层保证 | 否 |
| email | varchar(255) | YES | — | UNIQUE（允许多个 NULL） | 是 (unique) |
| createdAt | timestamptz | NO | now() | — | 否 |

关系：
- `User` 1 → N `Conversation`（`User.conversations`）
- 应用层可能还会反向查询 `AnalysisRequest`，但当前未声明反向 OneToMany。

## Conversation

表名：`conversations`，对应 `apps/server/src/entities/conversation.entity.ts`

| 字段 | 类型 | 可空 | 默认值 | 约束 | 索引 |
|------|------|------|--------|------|------|
| id | uuid | NO | gen_random_uuid() | PK | 是 (PK) |
| title | varchar(200) | NO | '新会话' | — | 否 |
| summary | text | YES | — | 预留长会话摘要 | 否 |
| userId | uuid | NO | — | FK → users.id ON DELETE CASCADE | 是 |
| createdAt | timestamptz | NO | now() | — | 否 |
| updatedAt | timestamptz | NO | now() | 任何 UPDATE 自动刷新 | 否 |

关系：
- N `Conversation` → 1 `User`（`Conversation.user`）
- 1 `Conversation` → N `Message`（`Conversation.messages`）

## Message

表名：`messages`，对应 `apps/server/src/entities/message.entity.ts`

| 字段 | 类型 | 可空 | 默认值 | 约束 | 索引 |
|------|------|------|--------|------|------|
| id | uuid | NO | gen_random_uuid() | PK | 是 (PK) |
| role | enum ('user','assistant','system') | NO | — | PG 枚举类型 `messages_role_enum` | 否 |
| content | text | NO | — | — | 否 |
| conversationId | uuid | NO | — | FK → conversations.id ON DELETE CASCADE | 是 |
| createdAt | timestamptz | NO | now() | — | 否 |

附加索引：
- `idx_messages_conversation_created (conversationId, createdAt)` — 支持"加载会话最新 N 条消息"分页查询。

关系：
- N `Message` → 1 `Conversation`（`Message.conversation`）

## AnalysisRequest

表名：`analysis_requests`，对应 `apps/server/src/entities/analysis-request.entity.ts`

| 字段 | 类型 | 可空 | 默认值 | 约束 | 索引 |
|------|------|------|--------|------|------|
| id | uuid | NO | gen_random_uuid() | PK | 是 (PK) |
| templateType | varchar(50) | NO | — | 取值: swot / decision_tree / pros_cons，应用层校验 | 否 |
| input | jsonb | NO | — | 任意 JSON 结构 | 否 |
| userId | uuid | NO | — | FK → users.id ON DELETE CASCADE | 是 |
| createdAt | timestamptz | NO | now() | — | 否 |

关系：
- N `AnalysisRequest` → 1 `User`（`AnalysisRequest.user`）
- 1 `AnalysisRequest` → N `AnalysisResult`（`AnalysisRequest.results`）

## AnalysisResult

表名：`analysis_results`，对应 `apps/server/src/entities/analysis-result.entity.ts`

| 字段 | 类型 | 可空 | 默认值 | 约束 | 索引 |
|------|------|------|--------|------|------|
| id | uuid | NO | gen_random_uuid() | PK | 是 (PK) |
| content | text | NO | — | 裁判模型产出的最终结论 | 否 |
| providerOutputs | text (simple-json) | YES | — | 各原始模型的输出，TypeORM 透明 JSON 序列化 | 否 |
| judgeModel | varchar(50) | NO | — | 例: 'deepseek' / 'kimi' / 'glm' | 否 |
| requestId | uuid | NO | — | FK → analysis_requests.id ON DELETE CASCADE | 是 |
| createdAt | timestamptz | NO | now() | — | 否 |

关系：
- N `AnalysisResult` → 1 `AnalysisRequest`（`AnalysisResult.request`）

## 索引汇总

| 表 | 索引名 | 列 | 类型 |
|----|--------|----|------|
| users | users_pkey | id | PK |
| users | idx_users_deviceId | deviceId | UNIQUE |
| users | idx_users_email | email | UNIQUE (nullable) |
| conversations | conversations_pkey | id | PK |
| conversations | idx_conversations_userId | userId | 普通索引 |
| messages | messages_pkey | id | PK |
| messages | idx_messages_conversationId | conversationId | 普通索引 |
| messages | idx_messages_conversation_created | conversationId, createdAt | 复合普通索引 |
| analysis_requests | analysis_requests_pkey | id | PK |
| analysis_requests | idx_analysis_requests_userId | userId | 普通索引 |
| analysis_results | analysis_results_pkey | id | PK |
| analysis_results | idx_analysis_results_requestId | requestId | 普通索引 |

## 迁移与回滚

- 初始迁移：`20260629000001-InitSchema.ts`（class `InitSchema20260629000001`）
- 上行：`pnpm --filter @xiaoyu/server migration:run`
- 回滚：`pnpm --filter @xiaoyu/server migration:revert`
- 迁移运行前需先 `pnpm --filter @xiaoyu/server build`，因为 `typeorm.config.ts` 指向 `dist/migrations/*.js`。
- 回滚时除了 `dropTable` 之外，会显式 `DROP TYPE IF EXISTS "messages_role_enum"`，因为 TypeORM 的 `dropTable` 不会自动删除 enum 类型。
