/** 运行标识由服务端安全生成，客户端请求标识仅用于幂等。 */
import { randomUUID } from 'node:crypto';
/** 业务异常以稳定HTTP状态对外表达。 */
import {
  ConflictException,
  HttpException,
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
/** 参数化查询与事务只访问应用拥有的连接池。 */
import type { PoolClient } from 'pg';
/** 统一校验持久化事件、运行和快照。 */
import {
  serverEventSchema,
  persistedRunSchema,
  conversationSnapshotSchema,
  answerFormatIssue,
  type ServerEvent,
  type PersistedRun,
} from '@journey/contracts';
/** 身份上下文来自守卫，不信任请求自报用户。 */
import type { Actor } from '../identity/auth.service.js';
/** 数据库基础设施集中管理连接和迁移。 */
import { StorageService } from '../../storage/storage.module.js';
/** 执行器模式来自后端配置，不能由请求体指定。 */
import { AppConfig } from '../../config/config.module.js';
/** 上下文类型与提示词版本由智能体模块声明。 */
import type { AgentInput } from '../agent/execution.types.js';
/** 记录版本用于追踪同一条运行使用的规则。 */
import { AGENT_PROMPT_VERSION } from '../agent/agent.prompt.js';
/** 运行SQL结果包含内部租约字段，序列化时必须白名单取值。 */
export interface RunRow {
  /** 当前执行进程的围栏标识，只用于数据库状态裁决。 */
  owner_id: string | null;
  /** 执行模式属于运行快照，重启不能偷换成诊断输出。 */
  executor: 'agent' | 'diagnostic';
  /** 已经发生的自动恢复次数。 */
  recovery_attempts: number;
  id: string;
  request_id: string;
  user_id: string;
  session_id: string;
  conversation_id: string;
  status: PersistedRun['status'];
  created_at: Date;
  lease_until: Date;
  cancel_requested: boolean;
  event_count: number;
  output_bytes: number;
}
/** 显式挑选公开运行信息。 */
export function publicRun(row: RunRow): PersistedRun {
  return persistedRunSchema.parse({
    id: row.id,
    requestId: row.request_id,
    conversationId: row.conversation_id,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  });
}
/** 行锁保证消息正文、事件序号与运行终态原子一致。 */
@Injectable()
/** SQL全部使用参数绑定，原文不写日志。 */
export class RuntimeRepository {
  /** 每次进程启动更换身份，数据库接管后拒绝旧执行器迟到写入。 */
  private readonly ownerId = randomUUID();
  /** 持有应用唯一存储服务。 */
  constructor(
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}
  /** 固定事务包装器，任何错误都会回滚并释放连接。 */
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    /** 从有上限的池获取连接，不创建额外连接池。 */
    const client = await this.storage.sql.connect();
    /** 事务退出时确保释放资源。 */
    try {
      await client.query('BEGIN');
      const value = await work(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      /** 失败不留下半条消息或半个运行。 */
      await client.query('ROLLBACK');
      throw error;
    } finally {
      /** 所有路径回收连接。 */
      client.release();
    }
    /** 结束事务方法。 */
  }
  /** 归属检查不能被客户端提供的conversationId绕过。 */
  async own(userId: string, conversationId: string): Promise<void> {
    const result = await this.storage.sql.query(
      'SELECT id FROM conversations WHERE id=$1 AND user_id=$2',
      [conversationId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('会话不存在');
  }
  /** 创建运行、两条消息和开始事件使用同一事务。 */
  async start(
    actor: Actor,
    conversationId: string,
    input: { requestId: string; message: string },
  ): Promise<{ run: PersistedRun; created: boolean }> {
    /** 全局短事务锁使多进程并发配额和请求去重保持一致。 */
    return this.transaction(async (client) => {
      /** 所有启动按相同锁顺序执行，避免并发跨会话死锁。 */
      await client.query('SELECT pg_advisory_xact_lock(77420903)');
      /** 会话行锁阻止快照与创建消息交错。 */
      const owned = await client.query(
        'SELECT * FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [conversationId, actor.userId],
      );
      /** 不区分不存在与其他用户资源。 */
      const conversation = owned.rows[0];
      if (!conversation) throw new NotFoundException('会话不存在');
      /** 相同用户请求ID只执行一次，重复提交不能改变原文或会话。 */
      const previous = await client.query<RunRow>(
        'SELECT * FROM runs WHERE user_id=$1 AND request_id=$2',
        [actor.userId, input.requestId],
      );
      /** 校验幂等请求的原始内容，冲突明确返回409。 */
      if (previous.rows[0]) {
        const old = previous.rows[0];
        const question = await client.query(
          "SELECT content FROM messages WHERE run_id=$1 AND role='user'",
          [old.id],
        );
        if (old.conversation_id !== conversationId || question.rows[0]?.content !== input.message)
          throw new ConflictException('请求标识已用于其他消息');
        return { run: publicRun(old), created: false };
      }
      /** 归档会话仍可读历史，但禁止启动新运行。 */
      if (conversation.archived) throw new ConflictException('请先恢复归档会话');
      /** 数据库配额覆盖所有进程；部分唯一索引提供第二层保护。 */
      const counts = await client.query(
        "SELECT count(*)::int AS total, count(*) FILTER (WHERE user_id=$1)::int AS own FROM runs WHERE status='running'",
        [actor.userId],
      );
      /** 每个用户最多一个活动任务，整体最多二十个。 */
      if (counts.rows[0].own >= 1 || counts.rows[0].total >= 20)
        throw new HttpException('运行配额已满，请等待或停止当前任务', 429);
      /** 租约超时后由恢复器写入明确失败终态。 */
      const inserted = await client.query<RunRow>(
        "INSERT INTO runs(id,request_id,user_id,session_id,conversation_id,owner_id,lease_until) VALUES($1,$2,$3,$4,$5,$6,clock_timestamp()+interval '30 seconds') RETURNING *",
        [
          randomUUID(),
          input.requestId,
          actor.userId,
          actor.sessionId,
          conversationId,
          this.ownerId,
        ],
      );
      /** 数据库保证INSERT返回一行。 */
      const row = inserted.rows[0]!;
      /** 运行身份在启动事务中保存；客户端重试不能改变执行模式。 */
      await client.query('UPDATE runs SET executor=$2,prompt_version=$3 WHERE id=$1', [
        row.id,
        this.config.env.CHAT_EXECUTOR,
        this.config.env.CHAT_EXECUTOR === 'agent' ? AGENT_PROMPT_VERSION : '',
      ]);
      /** 先分配两个单调消息位置，正文稍后随事件更新。 */
      await client.query(
        'UPDATE conversations SET message_count=message_count+2,updated_at=now() WHERE id=$1',
        [conversationId],
      );
      /** 同一运行最多一条用户输入和一条助手正文。 */
      await client.query(
        "INSERT INTO messages(id,run_id,conversation_id,role,content,position) VALUES($1,$2,$3,'user',$4,$5),($6,$2,$3,'assistant','',$7)",
        [
          randomUUID(),
          row.id,
          conversationId,
          input.message,
          conversation.message_count + 1,
          randomUUID(),
          conversation.message_count + 2,
        ],
      );
      /** 开始事件先提交，再启动实际工作，避免运行身份丢失。 */
      await this.appendLocked(client, row, 'run.started', {
        mode: this.config.env.CHAT_EXECUTOR,
        message:
          this.config.env.CHAT_EXECUTOR === 'agent'
            ? '智能体编排 · 已启动真实Deep Agents旅行助手'
            : '已启动持久化系统自检（显式诊断模式）',
      });
      /** 提交方得到固定运行ID，重试不会生成第二轮输入。 */
      return { run: publicRun(row), created: true };
      /** 结束启动事务。 */
    });
    /** 结束创建运行方法。 */
  }
  /** 调用方必须先锁定会话行再锁运行行，统一锁顺序。 */
  private async appendLocked(
    client: PoolClient,
    run: RunRow,
    type: ServerEvent['type'],
    payload: unknown,
  ): Promise<boolean> {
    /** 终态不可逆，迟到执行器不能覆盖取消或恢复失败。 */
    if (run.status !== 'running') return false;
    /** 判断本事件是否代表终态。 */
    const terminal =
      type === 'run.completed'
        ? 'completed'
        : type === 'run.cancelled'
          ? 'cancelled'
          : type === 'run.failed'
            ? 'failed'
            : null;
    /** 留出一个终态事件位置，并限制增量正文大小。 */
    const content = type === 'message.delta' ? (payload as { content: string }).content : '';
    const bytes = Buffer.byteLength(content);
    /** 超额由外层执行器转为受控失败事件。 */
    if (!terminal && (run.event_count >= 510 || run.output_bytes + bytes > 32768))
      throw new BadRequestException('运行输出已达到上限');
    /** 会话事件水位与JSON事件在同一事务更新。 */
    const sequence = await client.query(
      'UPDATE conversations SET event_sequence=event_sequence+1,updated_at=now() WHERE id=$1 RETURNING event_sequence',
      [run.conversation_id],
    );
    /** 公开协议阻止内部租约或凭据混入事件。 */
    const event = serverEventSchema.parse({
      protocolVersion: 1,
      id: randomUUID(),
      runId: run.id,
      sequence: sequence.rows[0].event_sequence,
      timestamp: new Date().toISOString(),
      type,
      payload,
    });
    /** 单事件体积有硬上限，工具返回不能无限增长。 */
    if (Buffer.byteLength(JSON.stringify(event)) > 16384)
      throw new BadRequestException('工具结果过大');
    /** 事件主键避免同一会话出现重复序号。 */
    await client.query(
      'INSERT INTO run_events(conversation_id,sequence,run_id,event) VALUES($1,$2,$3,$4)',
      [run.conversation_id, event.sequence, run.id, event],
    );
    /** 已经公开的正文与重放数据原子一致。 */
    if (content)
      await client.query(
        "UPDATE messages SET content=content||$1 WHERE run_id=$2 AND role='assistant'",
        [content, run.id],
      );
    /** 终态和结束时间一次写入，后续追加会被行锁后的状态检查拒绝。 */
    await client.query(
      'UPDATE runs SET event_count=event_count+1,output_bytes=output_bytes+$2,status=COALESCE($3,status),finished_at=CASE WHEN $3::text IS NULL THEN finished_at ELSE now() END WHERE id=$1',
      [run.id, bytes, terminal],
    );
    /** 成功表明确实生成了持久化事件。 */
    return true;
    /** 结束原子追加。 */
  }
  /** 任意执行器追加前重新检查数据库终态。 */
  async append(runId: string, type: ServerEvent['type'], payload: unknown): Promise<boolean> {
    /** 先读取不可变归属，然后以统一顺序锁定。 */
    return this.transaction(async (client) => {
      /** 运行删除时不产生新事件。 */
      const found = await client.query<RunRow>('SELECT * FROM runs WHERE id=$1', [runId]);
      const initial = found.rows[0];
      if (!initial) return false;
      /** 会话锁使快照水位和正文保持一致。 */
      await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [
        initial.conversation_id,
      ]);
      /** 运行锁确保并发取消、成功与恢复只有一个终态。 */
      const result = await client.query<RunRow>('SELECT * FROM runs WHERE id=$1 FOR UPDATE', [
        runId,
      ]);
      const run = result.rows[0]!;
      /** 围栏检查在行锁内执行，已经被其他进程接管的执行器不能发布正文或终态。 */
      if (run.owner_id !== this.ownerId) return false;
      /** 服务端已经收到取消后，不再发布新的增量或成功终态。 */
      if (run.cancel_requested && type !== 'run.cancelled' && type !== 'run.failed') return false;
      /** 统一实现状态机与事件一致性。 */
      return this.appendLocked(client, run, type, payload);
      /** 结束事件事务。 */
    });
    /** 结束追加方法。 */
  }
  /** 快照持有短会话锁，返回精确的重放起点。 */
  async snapshot(
    userId: string,
    conversationId: string,
    before: string | undefined,
    limit: number,
  ) {
    /** 查询和水位在同一事务内，不与事件追加交错。 */
    return this.transaction(async (client) => {
      /** 所有权始终带入数据库条件。 */
      const owned = await client.query(
        'SELECT event_sequence FROM conversations WHERE id=$1 AND user_id=$2 FOR UPDATE',
        [conversationId, userId],
      );
      if (!owned.rowCount) throw new NotFoundException('会话不存在');
      /** 只接受当前会话的真实消息游标。 */
      let position = 2147483647;
      if (before) {
        const cursor = await client.query(
          'SELECT position FROM messages WHERE id=$1 AND conversation_id=$2',
          [before, conversationId],
        );
        if (!cursor.rowCount) throw new NotFoundException('消息游标不存在');
        position = cursor.rows[0].position;
      }
      /** 最新一页先倒序读取，再按自然对话顺序输出。 */
      const page = await client.query(
        'SELECT m.*,r.status FROM messages m JOIN runs r ON r.id=m.run_id WHERE m.conversation_id=$1 AND m.position<$2 ORDER BY m.position DESC LIMIT $3',
        [conversationId, position, limit + 1],
      );
      /** 最新运行的所有公开步骤用于恢复执行面板，单运行最多512个事件。 */
      const latest = await client.query<RunRow>(
        'SELECT * FROM runs WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1',
        [conversationId],
      );
      const run = latest.rows[0];
      /** 只取最新运行轨迹，历史正文通过消息分页加载。 */
      const events = run
        ? await client.query(
            'SELECT event FROM run_events WHERE run_id=$1 ORDER BY sequence LIMIT 512',
            [run.id],
          )
        : { rows: [] };
      /** 去除内部字段并校验公开快照。 */
      const items = page.rows
        .slice(0, limit)
        .reverse()
        .map((row) => ({
          id: row.id,
          runId: row.run_id,
          role: row.role,
          content: row.content,
          position: row.position,
          createdAt: row.created_at.toISOString(),
          status: row.status,
        }));
      /** 水位不受分页游标影响，代表当前整个会话已提交事件。 */
      return conversationSnapshotSchema.parse({
        items,
        nextCursor: page.rows.length > limit ? items[0]?.id : null,
        run: run ? publicRun(run) : null,
        events: events.rows.map((row) => row.event),
        sequence: owned.rows[0].event_sequence,
      });
      /** 结束快照事务。 */
    });
    /** 结束快照读取。 */
  }
  /** 小批量重放使内存用量不随会话总长度增长。 */
  async events(conversationId: string, after: number): Promise<ServerEvent[]> {
    const result = await this.storage.sql.query(
      'SELECT event FROM run_events WHERE conversation_id=$1 AND sequence>$2 ORDER BY sequence LIMIT 64',
      [conversationId, after],
    );
    return result.rows.map((row) => serverEventSchema.parse(row.event));
  }
  /** 取消只允许归属匹配的用户，跨实例通过数据库标志传递。 */
  async cancel(userId: string, conversationId: string, runId: string): Promise<void> {
    await this.own(userId, conversationId);
    const result = await this.storage.sql.query(
      'UPDATE runs SET cancel_requested=true WHERE id=$1 AND conversation_id=$2 AND user_id=$3 RETURNING id',
      [runId, conversationId, userId],
    );
    if (!result.rowCount) throw new NotFoundException('运行不存在');
  }
  /** 续租同时检查登录会话是否撤销，登出后任务也停止。 */
  async renew(runId: string): Promise<boolean> {
    const result = await this.storage.sql.query(
      "UPDATE runs r SET lease_until=clock_timestamp()+interval '30 seconds' FROM refresh_sessions s,users u WHERE r.id=$1 AND r.owner_id=$2 AND r.status='running' AND NOT r.cancel_requested AND s.id=r.session_id AND s.revoked_at IS NULL AND s.expires_at>now() AND u.id=r.user_id AND u.disabled_at IS NULL RETURNING r.id",
      [runId, this.ownerId],
    );
    return Boolean(result.rowCount);
  }
  /** 查找过期任务时限制批次，恢复器不会一次读取全部历史。 */
  async expired(): Promise<string[]> {
    const result = await this.storage.sql.query(
      "SELECT id FROM runs WHERE status='running' AND lease_until<clock_timestamp() ORDER BY lease_until LIMIT 40",
    );
    return result.rows.map((row) => row.id as string);
  }
  /** 在统一锁顺序下接管真正过期的任务；数据库时钟避免应用与数据库时钟差误判。 */
  async claimExpired(runId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const found = await client.query<RunRow>('SELECT * FROM runs WHERE id=$1', [runId]);
      const initial = found.rows[0];
      if (!initial) return false;
      await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [
        initial.conversation_id,
      ]);
      const locked = await client.query<RunRow>(
        "SELECT * FROM runs WHERE id=$1 AND status='running' AND lease_until<clock_timestamp() FOR UPDATE",
        [runId],
      );
      const run = locked.rows[0];
      if (!run) return false;
      /** 取得锁之后再用数据库实时钟重查，不能使用事务开始时间或Node时钟。 */
      const expired = await client.query(
        'SELECT lease_until<clock_timestamp() AS expired FROM runs WHERE id=$1',
        [runId],
      );
      if (!expired.rows[0]?.expired) return false;
      const session = await client.query(
        'SELECT s.id FROM refresh_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() AND u.disabled_at IS NULL',
        [run.session_id],
      );
      if (run.cancel_requested || !session.rowCount) {
        await this.appendLocked(client, run, 'run.cancelled', {
          message: '运行已停止，已保存结果仍可查看。',
        });
        return false;
      }
      if (run.executor !== this.config.env.CHAT_EXECUTOR) {
        await this.appendLocked(client, run, 'run.failed', {
          code: 'EXECUTOR_CHANGED',
          message: '服务执行模式已更改，本轮没有重放；已保存资料仍可查看。',
        });
        return false;
      }
      if (run.recovery_attempts >= 2) {
        await this.appendLocked(client, run, 'run.failed', {
          code: 'RECOVERY_LIMIT',
          message: '服务连续中断，自动恢复已达上限；已保存资料仍可查看，请检查服务运行状态。',
        });
        return false;
      }
      await client.query(
        "UPDATE runs SET owner_id=$2,recovery_attempts=recovery_attempts+1,lease_until=clock_timestamp()+interval '30 seconds' WHERE id=$1",
        [runId, this.ownerId],
      );
      return true;
    });
  }
  /** 正文在第一个增量之前落库，进程在发布中途退出也能按精确前缀继续。 */
  async stageAnswer(runId: string, answer: string): Promise<boolean> {
    const saved = await this.storage.sql.query(
      "UPDATE runs SET final_answer=$3 WHERE id=$1 AND owner_id=$2 AND status='running' AND NOT cancel_requested AND (final_answer IS NULL OR final_answer=$3) RETURNING id",
      [runId, this.ownerId, answer],
    );
    return Boolean(saved.rowCount);
  }
  /** 优雅停服保留运行，下一进程可以立即接管；不会把维护重启当作业务失败。 */
  async release(runId: string): Promise<void> {
    await this.storage.sql.query(
      "UPDATE runs SET owner_id=NULL,lease_until=clock_timestamp() WHERE id=$1 AND owner_id=$2 AND status='running'",
      [runId, this.ownerId],
    );
  }
  /** 从数据库生成可信上下文；客户端不能注入别人的历史或system角色。 */
  async agentInput(runId: string): Promise<AgentInput> {
    /** 首先获取运行的不可变所有权与本轮消息位置。 */
    const result = await this.storage.sql.query(
      "SELECT r.*,m.position FROM runs r JOIN messages m ON m.run_id=r.id AND m.role='user' WHERE r.id=$1",
      [runId],
    );
    const run = result.rows[0];
    if (!run) throw new NotFoundException('运行不存在');
    /** 只读取同一用户、同一会话且不晚于当前输入的最多十三条普通消息。 */
    const history = await this.storage.sql.query(
      "SELECT m.role,m.content FROM messages m JOIN runs r ON r.id=m.run_id WHERE m.conversation_id=$1 AND r.user_id=$2 AND m.position<=$3 AND (m.role='user' OR r.status='completed') ORDER BY m.position DESC LIMIT 13",
      [run.conversation_id, run.user_id, run.position],
    );
    /** 按完整消息裁剪最多24000字符，最新用户输入总会保留。 */
    let characters = 0;
    const messages = history.rows
      /** 旧版本误存的模型内部格式不再作为assistant历史污染后续问答；用户原文保留。 */
      .filter((row) => row.role === 'user' || !answerFormatIssue(row.content))
      .filter((row) => {
        characters += row.content.length;
        return characters <= 24000;
      })
      .reverse()
      .map((row) => ({
        role: row.role as 'user' | 'assistant',
        content: row.content as string,
      }));
    /** 偏好归属同样由运行用户决定，不能由请求体自报。 */
    const profile = await this.storage.sql.query(
      'SELECT home_city,preferred_mode,pace FROM traveler_profiles WHERE user_id=$1',
      [run.user_id],
    );
    const value = profile.rows[0];
    /** 双重归属查询只带回需求及当前方案引用，不展开整份候选或私人认证数据。 */
    const travel = await this.storage.sql.query(
      `SELECT p.id,p.revision,p.document->'request' AS request,p.active_version_id,(SELECT payload FROM trip_option_sets s WHERE s.trip_id=p.id AND s.user_id=p.user_id ORDER BY created_at DESC,id DESC LIMIT 1) AS choices FROM trip_projects p WHERE p.user_id=$1 AND p.conversation_id=$2 AND NOT p.archived ORDER BY p.updated_at DESC LIMIT 1`,
      [run.user_id, run.conversation_id],
    );
    const project = travel.rows[0];
    const travelContext = project
      ? {
          id: project.id,
          revision: project.revision,
          request: project.request,
          activeVersionId: project.active_version_id,
          options: project.choices?.options?.map((option: any) => ({
            label: option.label,
            versionId: option.version.id,
            status: option.version.status,
          })),
          notice: '方案是否仍适用须由journey_arrange核对最新需求与候选。',
        }
      : null;
    /** 只返回执行器需要的字段，不包含登录令牌或密码摘要。 */
    return {
      runId,
      userId: run.user_id,
      conversationId: run.conversation_id,
      messages,
      travelContext,
      ...(run.final_answer
        ? {
            delivery: {
              answer: run.final_answer as string,
              published:
                (
                  await this.storage.sql.query(
                    "SELECT content FROM messages WHERE run_id=$1 AND role='assistant'",
                    [runId],
                  )
                ).rows[0]?.content ?? '',
            },
          }
        : {}),
      ...(run.recovery_attempts > 0 ? { recovery: await this.recoveryContext(runId) } : {}),
      profile: {
        homeCity: value?.home_city ?? '',
        preferredMode: value?.preferred_mode ?? 'independent',
        pace: value?.pace ?? 'balanced',
      },
    };
    /** 结束可信历史装配。 */
  }
  /** 只在恢复轮收尾丢失响应的调用；使用原callId，界面不会一直显示执行中。 */
  async settleInterruptedTools(runId: string): Promise<void> {
    const run = await this.storage.sql.query(
      'SELECT recovery_attempts FROM runs WHERE id=$1 AND owner_id=$2',
      [runId, this.ownerId],
    );
    if (!run.rows[0]?.recovery_attempts) return;
    const results = await this.storage.sql.query(
      "SELECT event FROM run_events WHERE run_id=$1 AND event->>'type' IN ('tool.started','tool.completed','tool.failed') ORDER BY sequence",
      [runId],
    );
    const pending = new Map<string, { name: string }>();
    for (const { event } of results.rows) {
      if (event.type === 'tool.started') pending.set(event.payload.callId, event.payload);
      else pending.delete(event.payload.callId);
    }
    for (const [callId, call] of pending)
      await this.append(runId, 'tool.failed', {
        callId,
        name: call.name,
        code: 'SERVICE_RESTARTED',
        message: '服务重启，此次调用结果尚未确认；已保存业务资料会继续使用，不会自动重复提交。',
        durationMs: 0,
      });
  }
  /** 恢复只整理已经保存的工具事实，不重放可能已经提交的业务写操作。 */
  private async recoveryContext(runId: string) {
    const events = await this.storage.sql.query(
      "SELECT event FROM run_events WHERE run_id=$1 AND event->>'type' IN ('tool.completed','tool.failed','agent.step') ORDER BY sequence DESC LIMIT 24",
      [runId],
    );
    /** 使用量独立查询，避免并行工具超过24条时把历史计数挤出窗口而重置预算。 */
    const [latestUsage, delegations] = await Promise.all([
      this.storage.sql.query(
        "SELECT event->'payload' AS usage FROM run_events WHERE run_id=$1 AND event->>'type'='agent.step' ORDER BY sequence DESC LIMIT 1",
        [runId],
      ),
      this.storage.sql.query(
        "SELECT count(*)::int AS total FROM run_events WHERE run_id=$1 AND event->>'type'='agent.step' AND event->'payload'->>'stage'='subagent.started'",
        [runId],
      ),
    ]);
    const usage = latestUsage.rows[0]?.usage;
    return {
      toolResults: events.rows
        .filter((row) => row.event.type !== 'agent.step')
        .reverse()
        .map((row) => row.event.payload),
      modelCalls: usage?.modelCalls ?? 0,
      toolCalls: usage?.toolCalls ?? 0,
      totalTokens: usage?.totalTokens ?? 0,
      estimated: Boolean(usage?.estimated),
      subagents: delegations.rows[0]?.total ?? 0,
    };
  }
  /** 结束运行仓储。 */
}
