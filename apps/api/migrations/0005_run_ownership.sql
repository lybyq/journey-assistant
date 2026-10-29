-- 每次服务启动生成独立执行身份，旧进程不能覆盖接管后的运行。
ALTER TABLE runs ADD COLUMN owner_id uuid;
-- 恢复次数有持久化上限，防止故障服务无限重复调用模型。
ALTER TABLE runs ADD COLUMN recovery_attempts integer NOT NULL DEFAULT 0 CHECK (recovery_attempts BETWEEN 0 AND 2);
