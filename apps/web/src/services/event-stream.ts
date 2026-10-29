/** 校验所有网络事件，拒绝不兼容协议。 */
import { serverEventSchema, type ServerEvent } from '@journey/contracts';
/** 有界解析跨块UTF-8和拆分的SSE帧，心跳不进入业务状态。 */
export class EventFrameParser {
  /** 未完成帧最多32KiB，中文字符使用流式解码。 */
  private buffer = '';
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });
  /** 每次输入真实网络字节，只向回调交付完整事件。 */
  push(chunk: Uint8Array, accept: (event: ServerEvent) => void): void {
    /** 保留跨块多字节字符，避免中文被替换成乱码。 */
    this.buffer += this.decoder.decode(chunk, { stream: true });
    /** 空行分隔帧，注释心跳没有data字段因此跳过。 */
    let end: number;
    while ((end = this.buffer.indexOf('\n\n')) >= 0) {
      const frame = this.buffer.slice(0, end);
      if (frame.length > 32768) throw new Error('事件帧过大');
      this.buffer = this.buffer.slice(end + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data: '))
        .map((line) => line.slice(6))
        .join('\n');
      if (data) accept(serverEventSchema.parse(JSON.parse(data)));
    }
    /** 损坏的未终止帧不能无限占用内存。 */
    if (this.buffer.length > 32768) throw new Error('事件帧过大');
    /** 结束单块解析。 */
  }
  /** 结束帧解析器。 */
}
