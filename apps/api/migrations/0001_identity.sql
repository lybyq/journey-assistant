-- 用户公开身份与唯一规范化邮箱。
CREATE TABLE users (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email varchar(254) NOT NULL UNIQUE, display_name varchar(50) NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), disabled_at timestamptz);
-- 凭据单独存储；只保存单向派生摘要。
CREATE TABLE credentials (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, password_hash text NOT NULL);
-- 每个登录会话定义一个固定期限的刷新令牌族。
CREATE TABLE refresh_sessions (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL, revoked_at timestamptz);
-- 按用户查询与撤销会话，不扫描所有用户的数据。
CREATE INDEX refresh_sessions_owner_idx ON refresh_sessions(user_id);
-- 保留历史令牌摘要以识别已消费令牌被再次提交。
CREATE TABLE refresh_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), session_id uuid NOT NULL REFERENCES refresh_sessions(id) ON DELETE CASCADE, token_hash varchar(64) NOT NULL UNIQUE, created_at timestamptz NOT NULL DEFAULT now(), consumed_at timestamptz);
-- 令牌族索引支持会话内历史清理与审计。
CREATE INDEX refresh_tokens_session_idx ON refresh_tokens(session_id);
-- 基础旅行资料具有数据库级枚举限制。
CREATE TABLE traveler_profiles (user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, home_city varchar(80) NOT NULL DEFAULT '', preferred_mode text NOT NULL DEFAULT 'independent' CHECK (preferred_mode IN ('independent','driving','group')), pace text NOT NULL DEFAULT 'balanced' CHECK (pace IN ('relaxed','balanced','intensive')));
-- 会话始终有所有者，归档保留可恢复数据。
CREATE TABLE conversations (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, title varchar(80) NOT NULL, archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
-- 复合索引用于同一用户下的稳定游标分页。
CREATE INDEX conversations_owner_created_idx ON conversations(user_id, created_at, id);
-- 审计记录不保存密码、令牌、邮件正文或聊天内容。
CREATE TABLE audit_events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES users(id) ON DELETE SET NULL, action varchar(64) NOT NULL, target_id text, created_at timestamptz NOT NULL DEFAULT now());
-- 审计按用户与时间查询，便于后续运营与安全排查。
CREATE INDEX audit_events_owner_created_idx ON audit_events(user_id, created_at);
