/** 生命周期与同步watch负责立即隔离旧会话网络回调。 */
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue';
/** 单轮显示继续复用经过测试的纯归约器。 */
import { useChatStore } from '@/stores/chat';
/** 会话选择和用户身份只有一个状态来源。 */
import { useIdentityStore } from '@/stores/identity';
/** 历史、运行与事件全部通过共享schema校验。 */
import { conversationSnapshotSchema, startRunResponseSchema, type PersistedMessage, type ServerEvent, type HealthSnapshot } from '@journey/contracts';
/** 凭据封装在网络层，组件不接触令牌。 */
import { authenticatedRequest, authenticatedStream, ApiError } from '@/services/http-client';
/** 网络字节按有界帧解析。 */
import { EventFrameParser } from '@/services/event-stream';
/** 健康探针只读取公开状态。 */
import { fetchHealth } from '@/services/api';
/** 管理历史、恢复、取消与重连；第四模块沿用这套生产通道。 */
export function useChatSession() {
  /** 身份与当前运行分别由两个仓库管理。 */
  const chat = useChatStore(); const identity = useIdentityStore();
  /** 连接状态与运行状态分离，断线不伪造任务失败。 */
  const connection = shallowRef<'connecting' | 'online' | 'offline'>('offline'); const health = shallowRef<HealthSnapshot | null>(null); const networkMessage = shallowRef('请先登录，消息将保存在你的账户下');
  /** 内存历史最多二百条，服务端按页读取。 */
  const messages = shallowRef<PersistedMessage[]>([]); const nextCursor = shallowRef<string | null>(null); const historyBusy = shallowRef(false); const submitting = shallowRef(false);
  /** 操作错误独立显示，不能被在线连接提示覆盖。 */
  const error = shallowRef('');
  /** 回调代数和游标不需要深层代理。 */
  let generation = 0; let lastSequence = 0; let controller: AbortController | undefined; let retry: ReturnType<typeof setTimeout> | undefined; let attempts = 0; let pending: { requestId: string; message: string } | undefined;
  /** 当前轮交给实时组件展示，历史列表排除它避免正文重复。 */
  const history = computed(() => messages.value.filter((item) => item.runId !== chat.state.runId));
  /** 用户登录后允许发送首条消息自动创建会话。 */
  const canSubmit = computed(() => Boolean(identity.user) && !chat.busy && !submitting.value && (connection.value === 'online' || !identity.selectedId));
  /** 主动断开立即让所有旧回调作废，不取消后台实际工作。 */
  function stopConnection(): number { generation += 1; clearTimeout(retry); controller?.abort(); controller = undefined; return generation; }
  /** 故障最多重试八次，以有界退避避免请求风暴。 */
  function reconnect(version: number): void { if (version !== generation) return; connection.value = 'offline'; networkMessage.value = '连接中断，后台运行继续；正在按序号恢复'; if (++attempts <= 8) retry = setTimeout(() => { void openStream(version); }, Math.min(1000 * 2 ** (attempts - 1), 15000)); else networkMessage.value = '自动重连已暂停，请点击重新连接恢复'; }
  /** 快照同时提供正文、最新轮轨迹和事件水位。 */
  async function restore(version: number, id: string): Promise<void> {
    /** 旧账户或旧会话的迟到结果不能污染当前页面。 */
    const snapshot = conversationSnapshotSchema.parse(await authenticatedRequest(`/conversations/${id}/messages`)); if (version !== generation) return;
    /** 从空状态重放最新轮，不能把快照正文再追加一次。 */
    messages.value = snapshot.items; nextCursor.value = snapshot.nextCursor; lastSequence = snapshot.sequence; chat.reset();
    /** 事件内保留实际工具名称、参数、结果和唯一终态。 */
    if (snapshot.run) { chat.begin(snapshot.items.find((item) => item.runId === snapshot.run?.id && item.role === 'user')?.content ?? '', snapshot.run.id); for (const event of snapshot.events) chat.apply(event); }
  /** 结束一致性恢复。 */
  }
  /** 去重后才归约事件，序号缺口必须补发。 */
  function accept(event: ServerEvent, version: number): void {
    /** 丢弃旧连接以及已确认事件。 */
    if (version !== generation || event.sequence <= lastSequence) return;
    /** 不允许静默跳过缺失事件导致正文损坏。 */
    if (event.sequence !== lastSequence + 1) throw new Error('事件序号不连续');
    /** 其他标签页启动新轮时重新读取真实输入和历史。 */
    if (event.runId !== chat.state.runId) { void connect(); return; }
    /** 成功归约完整事件后才移动游标。 */
    chat.apply(event); lastSequence = event.sequence;
  /** 结束事件处理。 */
  }
  /** 打开认证流；正常25秒轮换时也按已确认游标续传。 */
  async function openStream(version: number): Promise<void> {
    /** 身份或会话失效时不请求私有数据。 */
    const id = identity.selectedId; if (version !== generation || !id || !identity.user) return; const streamController = new AbortController(); controller = streamController; let heartbeat: ReturnType<typeof setTimeout> | undefined; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    /** 十秒无数据或心跳则中止并进入重连。 */
    const received = () => { clearTimeout(heartbeat); heartbeat = setTimeout(() => streamController.abort(), 10000); };
    /** 连接故障不改写服务端运行终态。 */
    try {
      /** URL只有会话和数字游标，访问凭据放HTTP头。 */
      received(); const response = await authenticatedStream(`/conversations/${id}/events?after=${lastSequence}`, streamController.signal); if (version !== generation) { await response.body?.cancel(); return; }
      /** 收到真实响应后才标记在线。 */
      if (!response.body) throw new Error('浏览器不支持流式响应'); reader = response.body.getReader(); const parser = new EventFrameParser(); connection.value = 'online'; networkMessage.value = '已连接 · 消息与轨迹实时保存';
      /** 每次读取一块，解析器只保存未完成帧。 */
      while (version === generation) { const result = await reader.read(); if (result.done) break; received(); parser.push(result.value, (event) => accept(event, version)); }
      /** 正常轮换不消耗故障重试次数。 */
      if (version === generation) { attempts = 0; retry = setTimeout(() => { void openStream(version); }, 150); }
    /** 权限问题停止重试，网络故障按最后序号补发。 */
    } catch (error) { if (version !== generation) return; if (error instanceof ApiError && [401,403,404].includes(error.status)) { connection.value = 'offline'; networkMessage.value = error.message; } else reconnect(version); }
    /** 清理心跳与reader，不保留旧连接资源。 */
    finally { clearTimeout(heartbeat); await reader?.cancel().catch(() => undefined); streamController.abort(); }
  /** 结束流连接。 */
  }
  /** 手动重连和会话恢复均使用同一快照入口。 */
  async function connect(): Promise<void> {
    /** 旧代数立即失效，再等待历史查询。 */
    const version = stopConnection(); const id = identity.selectedId; attempts = 0;
    /** 退出时立即清除私有正文。 */
    if (!identity.user || !id) { messages.value = []; nextCursor.value = null; chat.reset(); connection.value = identity.user ? 'online' : 'offline'; networkMessage.value = identity.user ? '首条消息将自动新建会话' : '请先登录，消息将保存在你的账户下'; return; }
    /** 加载快照期间不允许发送，避免覆盖新一轮。 */
    connection.value = 'connecting'; networkMessage.value = '正在恢复消息与执行轨迹';
    /** 可见错误保留手动重试入口。 */
    try { await restore(version, id); if (version === generation) void openStream(version); } catch (error) { if (version === generation) { connection.value = 'offline'; networkMessage.value = error instanceof Error ? error.message : '历史恢复失败'; } }
  /** 结束连接恢复。 */
  }
  /** 向更早消息分页，不能覆盖当前实时正文或游标。 */
  async function loadMore(): Promise<void> {
    /** 限制内存窗口并避免同页并发读取。 */
    if (!nextCursor.value || historyBusy.value || messages.value.length >= 200) return; historyBusy.value = true; error.value = ''; const version = generation; const id = identity.selectedId;
    /** 仅追加未出现过的消息ID。 */
    try { const page = conversationSnapshotSchema.parse(await authenticatedRequest(`/conversations/${id}/messages?before=${nextCursor.value}`)); if (version !== generation) return; const ids = new Set(messages.value.map((item) => item.id)); messages.value = [...page.items.filter((item) => !ids.has(item.id)), ...messages.value]; nextCursor.value = messages.value.length >= 200 ? null : page.nextCursor; }
    /** 错误在当前会话显示，旧会话结果不更新页面。 */
    catch (cause) { if (version === generation) error.value = cause instanceof Error ? cause.message : '历史加载失败'; }
    /** 解除分页忙碌状态。 */
    finally { historyBusy.value = false; }
  /** 结束历史分页。 */
  }
  /** 幂等提交与实时流分离，POST响应晚到也不会丢失事件。 */
  async function submit(message: string): Promise<boolean> {
    /** 同步锁住发送动作，限制正文长度。 */
    const text = message.trim(); if (!canSubmit.value || !text || text.length > 2000) return false; submitting.value = true; error.value = ''; const userId = identity.user?.id;
    /** 网络失败重试相同原文时沿用请求ID。 */
    const input = pending?.message === text ? pending : { requestId: crypto.randomUUID(), message: text }; pending = input;
    /** 自动新建的会话也必须先持久化与校验归属。 */
    try { if (!identity.selectedId) await identity.createConversation(); const id = identity.selectedId; stopConnection(); const version = generation; chat.begin(text, input.requestId); const result = startRunResponseSchema.parse(await authenticatedRequest(`/conversations/${id}/runs`, { method: 'POST', body: input })); if (userId !== identity.user?.id || version !== generation) return false; pending = undefined; chat.begin(text, result.run.id); await connect(); return true; }
    /** 不确定是否落库时恢复快照，不能擅自再生成第二轮输入。 */
    catch (cause) { if (userId === identity.user?.id) { const message = cause instanceof Error ? cause.message : '发送失败，请重试'; await connect(); error.value = message; } return false; }
    /** 失败和成功均释放提交锁。 */
    finally { submitting.value = false; }
  /** 结束提交。 */
  }
  /** HTTP取消可在流断线时使用，等待服务端唯一终态确认。 */
  async function cancel(): Promise<void> { if (submitting.value || !chat.busy || !chat.state.runId || !identity.selectedId) return; error.value = ''; const version = generation; try { await authenticatedRequest(`/conversations/${identity.selectedId}/runs/${chat.state.runId}/cancel`, { method: 'POST', body: {} }); if (version === generation && connection.value !== 'online') await connect(); } catch (cause) { if (version === generation) error.value = cause instanceof Error ? cause.message : '停止请求失败，请重试'; } }
  /** 用户或会话切换同步清理私有内容并使旧请求作废。 */
  watch(() => [identity.user?.id, identity.selectedId], () => { messages.value = []; chat.reset(); error.value = ''; pending = undefined; void connect(); }, { flush: 'sync' });
  /** 【模块04/05】运行终态后重新读取真实集成状态，不能一直展示初次加载的旧快照。 */
  watch(() => chat.state.status, (status) => { if (!['completed','cancelled','failed'].includes(status)) return; const version=generation; void fetchHealth().then((value) => { if(version===generation)health.value=value; }).catch(()=>undefined); });
  /** 健康探针与登录独立，失败不伪装在线。 */
  onMounted(() => { void fetchHealth().then((value) => { health.value = value; }).catch(() => { health.value = null; }); void connect(); });
  /** 离开页面只关闭传输，后台任务继续受超时与租约约束。 */
  onUnmounted(() => { stopConnection(); });
  /** 对外提供状态和动作，不暴露凭据与原生连接。 */
  return { chat, connection, health, networkMessage, canSubmit, connect, submit, cancel, history, nextCursor, historyBusy, loadMore, submitting, error };
/** 结束持久化对话composable。 */
}
