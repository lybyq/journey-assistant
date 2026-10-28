/** 【模块04-2】使用官方PostgreSQL checkpointer持久化LangGraph状态。 */
import { Injectable, type OnModuleInit } from '@nestjs/common';
/** SDK自行维护checkpoint表迁移版本。 */
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
/** 复用第三模块连接池，避免再创建一套无界数据库连接。 */
import { StorageService } from '../../storage/storage.module.js';
/** 无存储底座测试仍可独立启动。 */
import { AppConfig } from '../../config/config.module.js';
/** 检查点不作为公开聊天历史接口，不能由客户端提交thread_id。 */
@Injectable()
/** 独立schema与身份业务表分离，学习时可分别查看。 */
export class AgentCheckpointService implements OnModuleInit {
    /** 仅在真实存储初始化后建立保存器。 */
    saver?: PostgresSaver;
    /** 同一池同时服务业务与检查点，生命周期由StorageService负责。 */
    constructor(private readonly storage: StorageService, private readonly config: AppConfig) {
    }
    /** SDK setup需要互斥锁防止多API实例同时迁移。 */
    async onModuleInit(): Promise<void> {
        /** 未启用数据库时不创建MemorySaver冒充持久化。 */
        if (this.config.env.STORAGE_ENABLED !== 'true')
            return;
        /** 会话锁使用独立连接；SDK在同一池另外获取迁移连接。 */
        const lock = await this.storage.sql.connect();
        /** 初始化失败会使API启动失败，不悄悄降级。 */
        try {
            await lock.query('SELECT pg_advisory_lock(77420904)');
            const saver = new PostgresSaver(this.storage.sql, undefined, { schema: 'agent_checkpoints' });
            await saver.setup();
            this.saver = saver;
        }
        /** 所有路径释放迁移锁和占用连接。 */
        finally {
            await lock.query('SELECT pg_advisory_unlock(77420904)').catch(() => undefined);
            lock.release();
        }
        /** 结束checkpointer初始化。 */
    }
}
