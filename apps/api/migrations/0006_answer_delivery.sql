-- 最终正文先保存再分块发布，重启可从已发布前缀继续，避免丢字或重复正文。
ALTER TABLE runs ADD COLUMN final_answer text CHECK (octet_length(final_answer) <= 32768);
