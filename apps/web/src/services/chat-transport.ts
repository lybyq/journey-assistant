/** 导入共享的网络事件校验器和精确类型。 */
import { serverEventSchema, type ServerEvent } from '@journey/contracts';
/** 定义网络适配层事件回调，状态管理不依赖 DOM 或浏览器事件对象。 */
export interface TransportCallbacks {
  /** 所有通过协议校验的服务事件进入此回调。 */
  onEvent: (event: ServerEvent) => void;
  /** 网络断开或连接超时只使用安全可读提示。 */
  onClose: (message: string) => void;
  /** 结束回调约定。 */
}
/** 定义可替换的聊天传输接口，未来微信小程序可用 uni.connectSocket 实现。 */
export interface ChatTransport {
  /** 连接成功后发送明确命名的协议命令。 */
  send: (event: 'diagnostic.start' | 'run.cancel', data: Record<string, unknown>) => void;
  /** 卸载页面或重新连接时释放网络资源。 */
  close: () => void;
  /** 结束传输接口。 */
}
/** 创建浏览器传输；未来业务状态层无需关心底层 WebSocket 实现。 */
export function createChatTransport(callbacks: TransportCallbacks): ChatTransport {
  /** HTTPS 页面自动使用加密连接，同源代理无需暴露开发端口。 */
  const url =
    import.meta.env.VITE_WS_URL ||
    `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/chat`;
  /** 使用浏览器原生 WebSocket，与后端 ws 适配器保持协议一致。 */
  const socket = new WebSocket(url);
  /** 区分主动卸载和异常断线，避免主动关闭时显示错误。 */
  let intentionalClose = false;
  /** 限制握手等待时长，防止代理未启动时永远显示连接中。 */
  const timeout = setTimeout(() => {
    if (socket.readyState === WebSocket.CONNECTING) {
      socket.close();
      callbacks.onClose('连接超时，请确认后端已启动');
    }
  }, 8000);
  /** 连接成功后清理握手计时器。 */
  socket.onopen = () => clearTimeout(timeout);
  /** 网络数据必须先 JSON 解析，再通过共享协议校验。 */
  socket.onmessage = (message) => {
    /** 捕获损坏消息，避免异常直接中断 Vue 渲染。 */
    try {
      /** 不使用类型断言绕过运行时校验。 */
      const parsed = serverEventSchema.safeParse(JSON.parse(String(message.data)));
      /** 只转发符合版本与结构约束的事件。 */
      if (parsed.success) callbacks.onEvent(parsed.data);
      /** 协议不匹配时关闭连接并给出明确可恢复提示。 */ else {
        socket.close();
        callbacks.onClose('服务事件格式不兼容，请刷新页面');
      }
      /** 损坏 JSON 不向控制台输出完整外部原文。 */
    } catch {
      socket.close();
      callbacks.onClose('收到无效服务事件，请重新连接');
    }
    /** 结束消息监听。 */
  };
  /** 连接关闭时同步界面，不无限自动重试造成后台请求风暴。 */
  socket.onclose = () => {
    clearTimeout(timeout);
    if (!intentionalClose) callbacks.onClose('连接已断开，点击重新连接');
  };
  /** 浏览器不会给出安全且稳定的底层错误细节，因此使用统一提示。 */
  socket.onerror = () => {
    if (!intentionalClose) callbacks.onClose('无法连接后端，请确认服务已启动');
  };
  /** 返回小而稳定的传输 API。 */
  return {
    /** ws 适配器根据 event 分派，data 是经过服务端 schema 校验的实际参数。 */
    send: (event, data) => {
      if (socket.readyState !== WebSocket.OPEN) throw new Error('连接尚未就绪');
      socket.send(JSON.stringify({ event, data }));
    },
    /** 主动关闭时清理计时器并抑制误报。 */
    close: () => {
      intentionalClose = true;
      clearTimeout(timeout);
      socket.close();
    },
    /** 结束传输对象。 */
  };
  /** 结束浏览器传输工厂。 */
}
