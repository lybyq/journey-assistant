/** 搜索、抽取、来源去重与时效管理组成完整证据流程。 */
import { BadRequestException, Injectable } from '@nestjs/common';
/** 每条来源有稳定ID，预算与行程只引用该ID。 */
import { randomUUID } from 'node:crypto';
/** 保存前仍通过完整证据规范。 */
import {
  evidenceSchema,
  type Evidence,
  manualEvidenceSchema,
  researchQuerySchema,
} from '@journey/contracts';
/** 所有项目操作都经过同一个归属仓储。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** MCP会话在Search→Extract之间共享抽取许可。 */
import { TravelMcpService, asRecord, asRecords } from '../travel/travel-mcp.service.js';
/** 公共来源过滤与供应商抽取使用同一套URL边界。 */
import { isPublicUrl } from '../mcp/tool-safety.js';
/** 官方只接受确定域名，正文自称“官网”不能更改来源身份。 */
export function officialSource(url: string): boolean {
  const host = new URL(url).hostname.toLowerCase();
  return (
    host.endsWith('.gov.cn') ||
    host === '12306.cn' ||
    host.endsWith('.12306.cn') ||
    host === 'amap.com' ||
    host.endsWith('.amap.com') ||
    host.endsWith('.gov')
  );
}
/** 证据既有抓取结果，也有明确的抽取失败状态。 */
@Injectable()
export class ResearchService {
  /** 领域持久化与外部工具调用保持独立依赖。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly mcp: TravelMcpService,
  ) {}
  /** 优先限定官方旅游、景区和交通资料，但不保证搜索覆盖全网。 */
  async search(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof researchQuerySchema.parse>,
    signal: AbortSignal,
  ) {
    /** 先检查归属和旧版本，越权请求不应产生任何外部消耗。 */
    const workspace = await this.repository.get(userId, id);
    if (workspace.revision !== revision) throw new BadRequestException('项目已更新，请刷新');
    const now = new Date();
    /** 缓存使用真实到期时间，不用文章发布日期代替抓取时间。 */
    const cached = workspace.document.evidence.filter(
      (item) => item.query === input.query && Date.parse(item.expiresAt) > now.getTime(),
    );
    if (cached.length && !input.refresh) return { cached: true, workspace };
    /** 搜索工具只调用一次；最多抽取三个来源以控制额度。 */
    const call = await this.mcp.session(signal);
    const raw = asRecord(
      await call('tavily__tavily_search', {
        query: input.query,
        max_results: 5,
        search_depth: 'basic',
      }),
    );
    /** 只保留公共地址，按去认证/查询后的规范地址去重。 */
    const results = asRecords(raw.results);
    const unique = new Map<string, Record<string, any>>();
    for (const item of results) {
      if (typeof item.url === 'string' && isPublicUrl(item.url) && !unique.has(item.url))
        unique.set(item.url, item);
    }
    if (!unique.size) throw new BadRequestException('搜索没有返回可保存的公共来源');
    /** 抽取失败不会伪造成全文成功，搜索摘要仍可保留并标记。 */
    let extracted: Record<string, any>[] = [];
    let extractFailed = false;
    if (input.extract) {
      try {
        const data = asRecord(
          await call('tavily__tavily_extract', {
            urls: [...unique.keys()].slice(0, 3),
            extract_depth: 'basic',
          }),
        );
        extracted = asRecords(data.results);
      } catch (error) {
        if (signal.aborted) throw error;
        extractFailed = true;
      }
    }
    /** 来源摘录有界，商业营销中的“起价”只作为广告证据。 */
    const evidence: Evidence[] = [...unique.entries()].slice(0, 5).map(([url, item]) => {
      const full = extracted.find((entry) => entry.url === url);
      const excerpt = String(full?.raw_content ?? full?.content ?? item.content ?? '').slice(
        0,
        5000,
      );
      const price = /起价|低至|起\/|起订|from\s*[¥$€£]/i.test(excerpt);
      const publication =
        typeof item.published_date === 'string' && !Number.isNaN(Date.parse(item.published_date))
          ? new Date(item.published_date).toISOString()
          : null;
      return evidenceSchema.parse({
        id: randomUUID(),
        url,
        title: String(item.title ?? url).slice(0, 300),
        kind: officialSource(url) ? 'official' : 'web',
        publishedAt: publication,
        checkedAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + 6 * 3600000).toISOString(),
        excerpt,
        claims: excerpt
          ? [
              {
                text: price
                  ? '页面含营销价格；尚非指定日期授权报价'
                  : '来源摘录，关键营业与预约条件需要逐条核对',
                excerpt: excerpt.slice(0, 1800),
                topic: price ? 'price' : 'general',
                confidence: 'needs_confirmation',
              },
            ]
          : [],
        query: input.query,
        extraction: full ? 'success' : extractFailed ? 'failed' : 'snippet_only',
      });
    });
    /** 同URL更新保留ID，已有行程引用不会因重复搜索失效。 */
    const updated = await this.repository.mutate(userId, id, revision, (document) => {
      for (const item of evidence) {
        const previous = document.evidence.find((source) => source.url === item.url);
        if (previous) Object.assign(previous, item, { id: previous.id });
        else document.evidence.push(item);
      }
      return document;
    });
    return { cached: false, workspace: updated };
  }
  /** 允许用户录入已核实资料，来源身份固定manual且不会偷偷联网。 */
  async addManual(
    userId: string,
    id: string,
    revision: number,
    input: ReturnType<typeof manualEvidenceSchema.parse>,
  ) {
    if (!isPublicUrl(input.url)) throw new BadRequestException('来源必须是公共HTTP地址');
    const now = new Date();
    const canonical = new URL(input.url);
    canonical.search = '';
    canonical.hash = '';
    const evidence = evidenceSchema.parse({
      ...input,
      url: canonical.href,
      id: randomUUID(),
      kind: 'manual',
      checkedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 24 * 3600000).toISOString(),
      query: '用户录入资料',
      extraction: 'snippet_only',
    });
    return this.repository.mutate(userId, id, revision, (document) => {
      if (document.evidence.some((item) => item.url === evidence.url))
        throw new BadRequestException('该来源已存在，请使用刷新检索更新');
      document.evidence.push(evidence);
      return document;
    });
  }
}
