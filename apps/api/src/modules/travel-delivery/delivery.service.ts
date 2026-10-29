/** 分享固定版本，导出只使用已保存领域资料，不转发内部模型状态。 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
/** 分享秘密只返回一次，数据库保存摘要；随机值不能由用户指定。 */
import { createHash, randomBytes } from 'node:crypto';
/** 本地字体来自OFL授权的Noto CJK，不依赖用户电脑字体或运行时网络。 */
import { readFile } from 'node:fs/promises';
/** 中文PDF由Node库生成，保持后端全TypeScript。 */
import PDFDocument from 'pdfkit';
/** 公开版本和证据契约不含账户身份和供应商认证。 */
import { planVersionSchema, type PlanVersion, type Evidence } from '@journey/contracts';
/** 归属与版本持久化复用项目仓储。 */
import { TravelRepository } from '../travel/travel.repository.js';
/** 数据库和可信公开地址从后端注入。 */
import { StorageService } from '../../storage/storage.module.js';
/** 分享域名不相信浏览器提交的Host头。 */
import { AppConfig } from '../../config/config.module.js';
/** 人类可读时刻按日内分钟格式化，不能混成小数小时。 */
export function formatMinute(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
}
/** Markdown特殊字符转义保证用户标题不会构造导出链接或表格。 */
function escapeMarkdown(value: string): string {
  return value.replace(/[\\`*_{}\[\]<>#|]/g, '\\$&').replace(/\r?\n/g, ' ');
}
/** 导出来源只包含当前版本实际引用的公开摘录。 */
export function planSources(version: PlanVersion, evidence: Evidence[]): Evidence[] {
  if (version.sources.length) return version.sources;
  const ids = new Set(
    version.draft.days.flatMap((day) => day.items.flatMap((item) => item.evidenceIds)),
  );
  return evidence.filter((source) => ids.has(source.id));
}
/** 分享与本地导出使用同一个内容生成器，不输出用户邮箱或内部ID。 */
export function planMarkdown(version: PlanVersion, evidence: Evidence[]): string {
  const b = version.budget;
  /** 每一行报价使用自身币种；汇总使用预算目标币种，不能混写成同一金额单位。 */
  const money = (amount: number, currency = b.currency) =>
    (amount / 10 ** (currency === 'JPY' ? 0 : 2)).toFixed(currency === 'JPY' ? 0 : 2) +
    ' ' +
    currency;
  const lines = [
    '# ' + escapeMarkdown(version.draft.title),
    '',
    '版本 ' + version.version + ' · ' + version.draft.mode + ' · ' + version.draft.timeZone,
    '生成于 ' + version.createdAt + ' · 状态：' + version.status,
    '',
    '已知费用：' + money(b.knownTotalMinor),
    '预备金：' + money(b.reserveMinor),
    (b.complete ? '费用合计' : '部分费用小计（仍有未知）') + '：' + money(b.totalWithReserveMinor),
    '',
  ];
  for (const day of version.draft.days) {
    lines.push('## ' + day.date, '');
    for (const item of day.items)
      lines.push(
        '- ' +
          formatMinute(item.startMinute) +
          '–' +
          formatMinute(item.endMinute) +
          ' ' +
          escapeMarkdown(item.title) +
          (item.notes ? '：' + escapeMarkdown(item.notes) : ''),
      );
    lines.push('');
  }
  lines.push('## 本版本费用与条件', '');
  for (const price of version.prices) {
    const excluded = b.lines.find((line) => line.id === price.id)?.reason;
    lines.push(
      '- ' +
        escapeMarkdown(price.label) +
        '：' +
        (price.unitAmountMinor === null ? '未知' : money(price.unitAmountMinor, price.currency)) +
        ' × ' +
        price.quantity +
        ' ' +
        price.unit +
        ' · ' +
        price.priceType +
        (excluded ? ' · ' + escapeMarkdown(excluded) : ''),
      '  日期 ' +
        (price.conditions.startDate ?? '未知') +
        ' 至 ' +
        (price.conditions.endDate ?? '未知') +
        '；成人 ' +
        (price.conditions.adults ?? '未知') +
        '；儿童 ' +
        (price.conditions.children ?? '未知') +
        '；间数 ' +
        (price.conditions.rooms ?? '未知') +
        '；晚数 ' +
        (price.conditions.nights ?? '未知'),
      '  查询 ' +
        price.checkedAt +
        '；有效至 ' +
        (price.validUntil ?? '未承诺有效期') +
        '；来源 ' +
        escapeMarkdown(price.provider),
      '  ' + escapeMarkdown(price.notes),
    );
    if (price.sourceUrl) lines.push('  ' + price.sourceUrl);
  }
  if (b.issues.length) lines.push('', ...b.issues.map((issue) => '- ' + escapeMarkdown(issue)));
  if (version.violations.length)
    lines.push(
      '',
      '## 需要确认与调整',
      '',
      ...version.violations.map(
        (issue) => '- [' + issue.severity + '] ' + escapeMarkdown(issue.message),
      ),
      '',
    );
  if (version.draft.assumptions.length)
    lines.push(
      '## 估算假设',
      '',
      ...version.draft.assumptions.map((value) => '- ' + escapeMarkdown(value)),
      '',
    );
  const sources = planSources(version, evidence);
  lines.push('## 公开来源', '');
  if (!sources.length) lines.push('当前版本尚未引用可核实来源。');
  for (const source of sources)
    lines.push(
      '- [' +
        escapeMarkdown(source.title) +
        '](' +
        source.url +
        ') · 查询于 ' +
        source.checkedAt +
        ' · ' +
        source.extraction,
    );
  lines.push('', '报价为该版本保存时的快照，库存、营业、预约与有效期需要出发前重新核实。');
  return lines.join('\n');
}
/** 可撤销、限时、固定版本的分享服务。 */
@Injectable()
export class DeliveryService {
  /** 字体只读取一次；不会为每次导出重新从网络下载。 */
  private font?: Promise<Buffer>;
  /** 分享与项目版本分别受自身存储表约束。 */
  constructor(
    private readonly repository: TravelRepository,
    private readonly storage: StorageService,
    private readonly config: AppConfig,
  ) {}
  /** 每次创建都先验证项目和版本归属，旧链接不会跟随当前版本指针改变。 */
  async share(userId: string, id: string, versionId: string, hours: number) {
    await this.repository.version(userId, id, versionId);
    const token = randomBytes(32).toString('base64url');
    const hash = createHash('sha256').update(token).digest('hex');
    const expires = new Date(Date.now() + hours * 3600000);
    const client = await this.storage.sql.connect();
    try {
      await client.query('BEGIN');
      /** 锁项目行后计数和插入，避免并发越过20个有效分享限制。 */
      const project = await client.query(
        'SELECT id FROM trip_projects WHERE id=$1 AND user_id=$2 AND NOT archived FOR UPDATE',
        [id, userId],
      );
      if (!project.rowCount) throw new NotFoundException('旅行项目不存在或已归档');
      const count = await client.query(
        'SELECT count(*)::int AS n FROM trip_shares WHERE trip_id=$1 AND revoked_at IS NULL AND expires_at>now()',
        [id],
      );
      if (count.rows[0].n >= 20)
        throw new BadRequestException('每个旅行最多20个有效分享，请先撤销旧链接');
      const result = await client.query(
        'INSERT INTO trip_shares(trip_id,version_id,token_hash,expires_at) VALUES($1,$2,$3,$4) RETURNING id',
        [id, versionId, hash, expires],
      );
      await client.query('INSERT INTO audit_events(user_id,action,target_id) VALUES($1,$2,$3)', [
        userId,
        'trip.share_created',
        id,
      ]);
      await client.query('COMMIT');
      const publicUrl = this.config.env.PUBLIC_WEB_URL;
      const base = publicUrl.endsWith('/') ? publicUrl.slice(0, -1) : publicUrl;
      return {
        id: result.rows[0].id,
        url: base + '/share#' + token,
        expiresAt: expires.toISOString(),
        versionId,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  /** 分享列表从不返回令牌原文；遗失链接时可以撤销重建。 */
  async shares(userId: string, id: string) {
    await this.repository.get(userId, id);
    const result = await this.storage.sql.query(
      'SELECT id,version_id,expires_at,revoked_at,created_at FROM trip_shares WHERE trip_id=$1 ORDER BY created_at DESC LIMIT 50',
      [id],
    );
    return result.rows.map((row) => ({
      id: row.id,
      versionId: row.version_id,
      expiresAt: row.expires_at.toISOString(),
      revokedAt: row.revoked_at?.toISOString() ?? null,
      createdAt: row.created_at.toISOString(),
    }));
  }
  /** 撤销幂等，别人项目的分享ID不能被当前用户取消。 */
  async revoke(userId: string, id: string, shareId: string) {
    await this.repository.get(userId, id);
    const result = await this.storage.sql.query(
      'UPDATE trip_shares SET revoked_at=coalesce(revoked_at,now()) WHERE id=$1 AND trip_id=$2 RETURNING id',
      [shareId, id],
    );
    if (!result.rowCount) throw new NotFoundException('分享不存在');
    await this.audit(userId, 'trip.share_revoked', id);
    return { revoked: true };
  }
  /** 分享秘密通过POST正文发送，URL与服务器访问日志不含令牌。 */
  async resolve(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new NotFoundException('分享不存在或已过期');
    const hash = createHash('sha256').update(token).digest('hex');
    const result = await this.storage.sql.query(
      'SELECT v.payload,p.document FROM trip_shares s JOIN trip_versions v ON v.id=s.version_id AND v.trip_id=s.trip_id JOIN trip_projects p ON p.id=s.trip_id JOIN users u ON u.id=p.user_id WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND NOT p.archived AND u.disabled_at IS NULL',
      [hash],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundException('分享不存在或已过期');
    const version = planVersionSchema.parse(row.payload);
    const sources = planSources(version, row.document.evidence);
    return { version, sources, markdown: planMarkdown(version, sources) };
  }
  /** 私人导出与分享不同，始终需要当前有效账户凭据。 */
  async markdown(userId: string, id: string, versionId: string) {
    const version = await this.repository.version(userId, id, versionId);
    const workspace = await this.repository.get(userId, id);
    return planMarkdown(version, workspace.document.evidence);
  }
  /** 本地OFL字体检查可用后生成真正中文PDF，自动换行与分页。 */
  async pdf(userId: string, id: string, versionId: string): Promise<Buffer> {
    const text = await this.markdown(userId, id, versionId);
    this.font ??= readFile(
      new URL('../../../assets/fonts/NotoSansCJKsc-Regular.otf', import.meta.url),
    ).catch(() => {
      this.font = undefined;
      throw new ServiceUnavailableException('中文PDF字体不可用，请检查部署资源');
    });
    const font = await this.font;
    if (font.length < 1000000 || font.subarray(0, 4).toString() !== 'OTTO')
      throw new ServiceUnavailableException('中文PDF字体不完整，请检查部署资源');
    return new Promise<Buffer>((resolve, reject) => {
      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, right: 50, bottom: 50, left: 50 },
        info: { Title: '行也旅行方案', Author: '行也 Journey' },
      });
      const chunks: Buffer[] = [];
      doc.on('data', (part: Buffer) => chunks.push(part));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', () => reject(new ServiceUnavailableException('PDF生成失败')));
      try {
        doc
          .font(font)
          .fontSize(10)
          .fillColor('#244b43')
          .text(text.replace(/^#+\s/gm, '').replace(/\\([\\`*_{}\[\]<>#|])/g, '$1'), {
            lineGap: 5,
            width: 495,
          });
        doc.end();
      } catch {
        doc.destroy();
        reject(new ServiceUnavailableException('PDF排版失败，请检查字体与版本内容'));
      }
    });
  }
  /** 审计只记录行为和资源标识，不保存分享秘密。 */
  private async audit(userId: string, action: string, id: string) {
    await this.storage.sql.query(
      'INSERT INTO audit_events(user_id,action,target_id) VALUES($1,$2,$3)',
      [userId, action, id],
    );
  }
}
