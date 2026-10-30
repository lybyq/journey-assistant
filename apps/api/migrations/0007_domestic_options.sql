-- 国内方案集合保留生成时的项目指纹与不可变版本，不改写历史行程。
CREATE TABLE trip_option_sets (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES trip_projects(id) ON DELETE CASCADE,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
-- 用户/项目过滤用于恢复最近一次生成结果，不能跨账户读取。
CREATE INDEX trip_option_sets_owner_trip_created ON trip_option_sets(user_id,trip_id,created_at DESC);
