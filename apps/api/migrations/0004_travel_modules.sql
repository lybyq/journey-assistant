-- 旅行项目聚合按用户归属；旧迁移保持原样。
CREATE TABLE trip_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 conversation_id uuid REFERENCES conversations(id) ON DELETE SET NULL, title varchar(100) NOT NULL,
 document jsonb NOT NULL, revision integer NOT NULL DEFAULT 0 CHECK(revision >= 0), archived boolean NOT NULL DEFAULT false,
 active_version_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(pg_column_size(document) <= 1048576)
);
CREATE INDEX trip_projects_owner_idx ON trip_projects(user_id,created_at DESC,id);
-- 旧方案永不UPDATE；回退仅改变项目的当前版本指针。
CREATE TABLE trip_versions (
 id uuid PRIMARY KEY, trip_id uuid NOT NULL REFERENCES trip_projects(id) ON DELETE CASCADE,
 version integer NOT NULL CHECK(version > 0), payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(trip_id,version), CHECK(pg_column_size(payload) <= 524288)
);
-- 分享令牌只存SHA-256摘要，原文仅在创建响应出现一次。
CREATE TABLE trip_shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), trip_id uuid NOT NULL REFERENCES trip_projects(id) ON DELETE CASCADE,
 version_id uuid NOT NULL REFERENCES trip_versions(id) ON DELETE CASCADE, token_hash char(64) NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_shares_trip_idx ON trip_shares(trip_id,created_at DESC);
-- 仅记录有限运行指标和错误码，拒绝把提示词、秘密和网页正文放进监控表。
CREATE TABLE trip_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 trip_id uuid NOT NULL REFERENCES trip_projects(id) ON DELETE CASCADE, module integer NOT NULL CHECK(module BETWEEN 6 AND 14),
 operation varchar(80) NOT NULL, status varchar(20) NOT NULL CHECK(status IN ('completed','failed','cancelled')),
 duration_ms integer NOT NULL, code varchar(80), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_operations_owner_idx ON trip_operations(user_id,created_at DESC);
