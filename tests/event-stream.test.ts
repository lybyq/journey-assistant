/** 纯解析器与真实网络字节约定保持一致。 */
import { describe, expect, it } from 'vitest';
/** 安全UUID构造合法协议事件。 */
import { randomUUID } from 'node:crypto';
/** 运行时导入不依赖Vue和浏览器网络。 */
import { EventFrameParser } from '../apps/web/src/services/event-stream';
/** 使用实际服务器事件类型检查归约结果。 */
import type { ServerEvent } from '@journey/contracts';
/** 跨块、心跳与损坏数据必须按行为验证。 */
describe('有界事件帧解析', () => {
  /** 每个UTF-8字节独立到达时，中文仍完整且只交付一次。 */
  it('正确处理逐字节中文和心跳', () => { const parser = new EventFrameParser(); const events: ServerEvent[] = []; const event = { protocolVersion: 1, id: randomUUID(), runId: randomUUID(), sequence: 1, timestamp: new Date().toISOString(), type: 'message.delta', payload: { content: '杭州旅行 🧭' } }; const bytes = new TextEncoder().encode(`: heartbeat\n\nid: 1\ndata: ${JSON.stringify(event)}\n\n`); for (const byte of bytes) parser.push(new Uint8Array([byte]), (item) => events.push(item)); expect(events).toEqual([event]); });
  /** 无效协议和未结束大帧直接失败，不能无限缓存。 */
  it('拒绝无效事件与超大帧', () => { expect(() => new EventFrameParser().push(new TextEncoder().encode('data: {}\n\n'), () => undefined)).toThrow(); expect(() => new EventFrameParser().push(new TextEncoder().encode('x'.repeat(32769)), () => undefined)).toThrow('事件帧过大'); });
/** 结束解析器验证。 */
});
