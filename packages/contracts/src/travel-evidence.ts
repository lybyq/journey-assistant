/** 来源、摘录和结论分别保留，发布时间不等同于查询时间。 */
import { z } from 'zod';
/** 只允许可核查的公共链接和有界文字。 */
import { sourceUrlSchema, shortText } from './travel-common.js';
/** 事实结论绑定来源片段，不能把模型自由推断伪造成引文。 */
export const claimSchema = z
  .object({
    text: shortText,
    excerpt: z.string().max(2000),
    topic: z.enum(['general', 'opening', 'reservation', 'closure', 'price', 'transport']),
    confidence: z.enum(['quoted', 'needs_confirmation']),
  })
  .strict();
/** 证据保留过期时间与来源类型；official由后端域名规则判断。 */
export const evidenceSchema = z
  .object({
    id: z.string().uuid(),
    url: sourceUrlSchema,
    title: shortText,
    kind: z.enum(['official', 'web', 'manual']),
    publishedAt: z.string().datetime().nullable(),
    checkedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    excerpt: z.string().max(6000),
    claims: z.array(claimSchema).max(15),
    query: z.string().max(500),
    extraction: z.enum(['success', 'snippet_only', 'failed']),
  })
  .strict();
/** 手工证据不能自报官方身份，服务端统一记录manual来源。 */
export const manualEvidenceSchema = z
  .object({
    url: sourceUrlSchema,
    title: shortText,
    excerpt: z.string().min(1).max(6000),
    publishedAt: z.string().datetime().nullable().default(null),
    claims: z.array(claimSchema).max(15).default([]),
  })
  .strict();
/** 查询范围与抽取数量有限制，避免无限搜索消耗。 */
export const researchQuerySchema = z
  .object({
    query: z.string().min(2).max(500),
    extract: z.boolean().default(true),
    refresh: z.boolean().default(false),
  })
  .strict();
/** 公开来源类型供地图、预算、导出复用。 */
export type Evidence = z.infer<typeof evidenceSchema>;
