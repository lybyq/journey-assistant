-- 会话级持久化序号与消息顺序只由数据库分配。
ALTER TABLE conversations ADD COLUMN event_sequence integer NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN message_count integer NOT NULL DEFAULT 0;
-- 运行租约使进程崩溃后的运行可以显式失败，不永久停留在执行中。
CREATE TABLE runs (
  id uuid PRIMARY KEY, request_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES refresh_sessions(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'running' CHECK (status IN ('running','completed','cancelled','failed')),
  created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz, lease_until timestamptz NOT NULL,
  cancel_requested boolean NOT NULL DEFAULT false, event_count integer NOT NULL DEFAULT 0,
  output_bytes integer NOT NULL DEFAULT 0, UNIQUE(user_id, request_id)
);
-- 一个用户、一个会话均最多拥有一个活动运行，即使请求来自多个API实例。
CREATE UNIQUE INDEX runs_active_user_idx ON runs(user_id) WHERE status='running';
CREATE UNIQUE INDEX runs_active_conversation_idx ON runs(conversation_id) WHERE status='running';
CREATE INDEX runs_conversation_created_idx ON runs(conversation_id, created_at DESC, id DESC);
CREATE INDEX runs_lease_idx ON runs(lease_until) WHERE status='running';
-- 用户输入和助手已发送内容在每个事件事务中同步保存。
CREATE TABLE messages (
  id uuid PRIMARY KEY, run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user','assistant')), content text NOT NULL DEFAULT '',
  position integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(conversation_id,position), UNIQUE(run_id,role), CHECK(octet_length(content)<=65536)
);
-- 事件唯一序号负责补发与去重；单个运行事件数由执行器限制。
CREATE TABLE run_events (
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sequence integer NOT NULL, run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  event jsonb NOT NULL, PRIMARY KEY(conversation_id,sequence)
);
CREATE INDEX run_events_run_idx ON run_events(run_id,sequence);
