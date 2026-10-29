-- 旧运行保持诊断身份，新运行明确记录实际执行器与提示词版本。
ALTER TABLE runs ADD COLUMN executor text NOT NULL DEFAULT 'diagnostic' CHECK(executor IN ('diagnostic','agent'));
ALTER TABLE runs ADD COLUMN prompt_version text NOT NULL DEFAULT '';
-- checkpoint表由官方PostgresSaver在独立agent_checkpoints schema内维护迁移账本。
