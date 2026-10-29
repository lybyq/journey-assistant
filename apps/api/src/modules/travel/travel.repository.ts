/** 单一项目仓储负责归属、事务与乐观锁，不承担业务计算。 */
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
/** PostgreSQL事务连接由存储模块统一拥有。 */
import type { PoolClient } from 'pg';
/** 服务端每次读写都校验持久化结构。 */
import {
  tripDocumentSchema,
  tripWorkspaceSchema,
  planVersionSchema,
  type TripDocument,
  type TripWorkspace,
  type PlanVersion,
} from '@journey/contracts';
/** 不建立第二套数据库连接池。 */
import { StorageService } from '../../storage/storage.module.js';
/** 私密字段在落库前统一清理。 */
import { McpService } from '../mcp/mcp.service.js';
/** 需求规范化与澄清问题由旅行需求提供。 */
import { TripRequestService } from '../trip-request/request.service.js';
/** 数据行中的所有权始终来自数据库，而不是JSON文档。 */
interface TripRow {
  id: string;
  user_id: string;
  conversation_id: string | null;
  title: string;
  document: TripDocument;
  revision: number;
  created_at: Date;
  updated_at: Date;
  archived: boolean;
  active_version_id: string | null;
}
/** 按用户隔离的旅行项目持久化入口。 */
@Injectable()
export class TravelRepository {
  /** 注入原有存储与安全边界，领域服务之间不互相创建资源。 */
  constructor(
    private readonly storage: StorageService,
    private readonly mcp: McpService,
    private readonly requests: TripRequestService,
  ) {}
  /** 全文JSON先清理秘密再解析，绝不使用递归30项裁剪器静默丢失业务数组。 */
  clean<T>(value: T): T {
    const raw = JSON.stringify(value);
    if (Buffer.byteLength(raw) > 900000)
      throw new BadRequestException('旅行项目体积已达上限，请新建项目');
    try {
      return JSON.parse(this.mcp.safety.text(raw, 950000)) as T;
    } catch {
      throw new BadRequestException('旅行资料格式不合法');
    }
  }
  /** 容量边界转换成明确业务错误，避免模型把Zod异常当供应商故障反复补查。 */
  private parseDocument(value: unknown): TripDocument {
    const parsed = tripDocumentSchema.safeParse(value);
    if (parsed.success) return parsed.data;
    const labels: Record<string, string> = {
      transport: '交通候选',
      experiences: '住宿游玩候选',
      costs: '费用项',
      evidence: '来源资料',
      driving: '自驾路线',
      tours: '旅行团',
    };
    const limit = parsed.error.issues.find(
      (issue) => issue.code === 'too_big' && issue.path.length === 1,
    );
    if (limit?.code === 'too_big')
      throw new BadRequestException(
        `${labels[String(limit.path[0])] ?? '旅行资料'}最多${limit.maximum}项，请停止重复查询并使用已保存候选，或新建旅行项目`,
      );
    throw new BadRequestException('旅行资料格式不符合要求，请核对查询条件，不要重复执行相同请求');
  }
  /** 聚合内实体ID必须唯一；报价快照可以被候选引用，但不能重复入账。 */
  private validateDocument(document: TripDocument): TripDocument {
    for (const key of [
      'evidence',
      'transport',
      'driving',
      'experiences',
      'tours',
      'costs',
    ] as const) {
      const ids = document[key].map((item) => item.id);
      if (new Set(ids).size !== ids.length) throw new BadRequestException(`${key}存在重复ID`);
    }
    const evidence = new Set(document.evidence.map((item) => item.id));
    const costs = new Set(document.costs.map((item) => item.id));
    for (const item of [
      ...document.costs,
      ...document.transport,
      ...document.experiences,
      ...document.tours,
    ]) {
      if (item.evidenceIds.some((id) => !evidence.has(id)))
        throw new BadRequestException('资料引用了不存在的来源');
    }
    for (const item of [...document.transport, ...document.experiences, ...document.tours]) {
      if (item.quote && !costs.has(item.quote.id))
        throw new BadRequestException('候选报价尚未进入费用集合');
    }
    return document;
  }
  /** 审计与领域写入处于同一事务，回滚后不会留下虚假的成功记录。 */
  private async audit(client: PoolClient, userId: string, action: string, id: string) {
    await client.query('INSERT INTO audit_events(user_id,action,target_id) VALUES($1,$2,$3)', [
      userId,
      action,
      id,
    ]);
  }
  /** 默认只返回最近50个项目，用户数据永远按owner过滤。 */
  async list(userId: string) {
    const result = await this.storage.sql.query(
      'SELECT id,title,revision,archived,created_at,updated_at FROM trip_projects WHERE user_id=$1 ORDER BY created_at DESC,id DESC LIMIT 50',
      [userId],
    );
    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      revision: row.revision,
      archived: row.archived,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }));
  }
  /** 单次项目读取同时返回需求、领域候选与有界版本列表。 */
  async get(userId: string, id: string): Promise<TripWorkspace> {
    const row = await this.own(this.storage.sql, userId, id);
    return this.snapshot(row);
  }
  /** 不存在与越权统一404，防止枚举别人的旅行项目。 */
  private async own(
    client: Pick<PoolClient, 'query'>,
    userId: string,
    id: string,
    lock = false,
  ): Promise<TripRow> {
    const result = await client.query<TripRow>(
      `SELECT * FROM trip_projects WHERE id=$1 AND user_id=$2${lock ? ' FOR UPDATE' : ''}`,
      [id, userId],
    );
    if (!result.rows[0]) throw new NotFoundException('旅行项目不存在');
    return result.rows[0];
  }
  /** 每个新项目有独立聚合；绑定聊天前也检查会话归属。 */
  async create(
    userId: string,
    title: string,
    conversationId: string | null,
    document: TripDocument,
  ): Promise<TripWorkspace> {
    /** 事务行锁与写入都在同一个真实连接上。 */
    return this.transaction(async (client) => {
      /** 同一用户创建项目先锁用户行，防止并发绕过100项目总量限制。 */
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [userId]);
      if (conversationId) {
        const own = await client.query(
          'SELECT id FROM conversations WHERE id=$1 AND user_id=$2 AND NOT archived FOR SHARE',
          [conversationId, userId],
        );
        if (!own.rowCount) throw new NotFoundException('会话不存在');
      }
      const count = await client.query(
        'SELECT count(*)::int AS n FROM trip_projects WHERE user_id=$1',
        [userId],
      );
      if (count.rows[0].n >= 100) throw new BadRequestException('最多保存100个旅行项目');
      const saved = await client.query<TripRow>(
        'INSERT INTO trip_projects(user_id,title,conversation_id,document) VALUES($1,$2,$3,$4) RETURNING *',
        [
          userId,
          this.mcp.safety.text(title, 400),
          conversationId,
          this.validateDocument(this.parseDocument(this.clean(document))),
        ],
      );
      await this.audit(client, userId, 'trip.created', saved.rows[0]!.id);
      return this.snapshot(saved.rows[0]!, client);
    });
  }
  /** 后续模块都通过此方法写入，不能绕开归属、CAS和完整结构校验。 */
  async mutate(
    userId: string,
    id: string,
    revision: number,
    work: (document: TripDocument) => TripDocument,
    metadata?: { title?: string; archived?: boolean },
  ): Promise<TripWorkspace> {
    return this.transaction(async (client) => {
      const row = await this.own(client, userId, id, true);
      if (row.revision !== revision)
        throw new ConflictException('项目已被另一操作更新，请刷新后重试');
      if (row.archived && metadata?.archived !== false)
        throw new BadRequestException('请先恢复已归档项目');
      const document = this.parseDocument(this.clean(work(structuredClone(row.document))));
      document.request = this.requests.normalize({}, document.request);
      this.validateDocument(document);
      const result = await client.query<TripRow>(
        'UPDATE trip_projects SET document=$3,revision=revision+1,title=$4,archived=$5,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *',
        [
          id,
          userId,
          document,
          metadata?.title === undefined ? row.title : this.mcp.safety.text(metadata.title, 400),
          metadata?.archived ?? row.archived,
        ],
      );
      await this.audit(client, userId, 'trip.updated', id);
      return this.snapshot(result.rows[0]!, client);
    });
  }
  /** 保存版本时项目修订号参与竞争裁决，生成期间资料变化不能被忽略。 */
  async saveVersion(
    userId: string,
    id: string,
    revision: number,
    build: (version: number) => PlanVersion,
  ): Promise<PlanVersion> {
    return this.transaction(async (client) => {
      const row = await this.own(client, userId, id, true);
      if (row.revision !== revision)
        throw new ConflictException('生成期间旅行资料已变化，请重新生成');
      if (row.archived) throw new BadRequestException('请先恢复已归档项目');
      const count = await client.query(
        'SELECT coalesce(max(version),0)::int AS n FROM trip_versions WHERE trip_id=$1',
        [id],
      );
      if (count.rows[0].n >= 50) throw new BadRequestException('单项目最多50个版本');
      const version = planVersionSchema.parse(this.clean(build(count.rows[0].n + 1)));
      await client.query(
        'INSERT INTO trip_versions(id,trip_id,version,payload) VALUES($1,$2,$3,$4)',
        [version.id, id, version.version, version],
      );
      await client.query(
        'UPDATE trip_projects SET active_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1',
        [id, version.id],
      );
      await this.audit(client, userId, 'trip.version_saved', id);
      return version;
    });
  }
  /** 任意版本访问都先验证父项目所有权。 */
  async version(userId: string, id: string, versionId: string): Promise<PlanVersion> {
    await this.own(this.storage.sql, userId, id);
    const result = await this.storage.sql.query(
      'SELECT payload FROM trip_versions WHERE id=$1 AND trip_id=$2',
      [versionId, id],
    );
    if (!result.rows[0]) throw new NotFoundException('行程版本不存在');
    return planVersionSchema.parse(result.rows[0].payload);
  }
  /** 回退只切换指针，不重写旧版本，也不假装当年的报价仍然有效。 */
  async activate(userId: string, id: string, revision: number, versionId: string) {
    return this.transaction(async (client) => {
      const row = await this.own(client, userId, id, true);
      if (row.revision !== revision) throw new ConflictException('项目已更新，请刷新');
      if (row.archived) throw new BadRequestException('请先恢复项目');
      const own = await client.query('SELECT id FROM trip_versions WHERE id=$1 AND trip_id=$2', [
        versionId,
        id,
      ]);
      if (!own.rowCount) throw new NotFoundException('行程版本不存在');
      const result = await client.query<TripRow>(
        'UPDATE trip_projects SET active_version_id=$2,revision=revision+1,updated_at=now() WHERE id=$1 RETURNING *',
        [id, versionId],
      );
      await this.audit(client, userId, 'trip.version_activated', id);
      return this.snapshot(result.rows[0]!, client);
    });
  }
  /** 聊天绑定可以自动找到该账户最近的有效项目。 */
  async forConversation(userId: string, conversationId: string): Promise<TripWorkspace | null> {
    const result = await this.storage.sql.query(
      'SELECT id FROM trip_projects WHERE user_id=$1 AND conversation_id=$2 AND NOT archived ORDER BY updated_at DESC LIMIT 1',
      [userId, conversationId],
    );
    return result.rows[0] ? this.get(userId, result.rows[0].id) : null;
  }
  /** 组装公开结构时不展开用户ID、数据库认证或内部SQL行。 */
  private async snapshot(
    row: TripRow,
    client: Pick<PoolClient, 'query'> = this.storage.sql,
  ): Promise<TripWorkspace> {
    /** 事务内复用原连接，避免池被十个外层事务占满后等待第十一个连接。 */
    const result = await client.query(
      'SELECT id,version,payload,created_at FROM trip_versions WHERE trip_id=$1 ORDER BY version DESC LIMIT 50',
      [row.id],
    );
    const document = tripDocumentSchema.parse(row.document);
    return tripWorkspaceSchema.parse({
      id: row.id,
      title: row.title,
      conversationId: row.conversation_id,
      revision: row.revision,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
      archived: row.archived,
      document,
      activeVersionId: row.active_version_id,
      clarifications: this.requests.clarifications(document.request),
      versions: result.rows.map((v) => ({
        id: v.id,
        version: v.version,
        title: v.payload.draft.title,
        mode: v.payload.draft.mode,
        status: v.payload.status,
        createdAt: v.created_at.toISOString(),
      })),
    });
  }
  /** 所有事务无论成功、业务拒绝还是SQL错误都释放连接。 */
  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.storage.sql.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
