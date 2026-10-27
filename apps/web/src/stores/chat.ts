/** 使用 Pinia 集中管理运行状态，避免组件直接控制网络连接。 */
import { defineStore } from "pinia";
/** 使用浅层响应状态和纯归约器，网络结果按整体替换更新。 */
import { computed, shallowRef } from "vue";
/** 只引用共享事件类型，不把后端 SDK 打进浏览器。 */
import type { ServerEvent } from "@journey/contracts";
/** 引入不依赖 Vue 的纯状态转换逻辑。 */
import { initialChatState, reduceChatEvent } from "@/features/chat/chat-state";
/** 定义聊天状态仓库，当前仅保存本标签页状态，不冒充数据库历史。 */
export const useChatStore = defineStore("chat", () => {
  /** 当前运行状态以不可变方式整体替换。 */
  const state = shallowRef(initialChatState());
  /** busy 从状态推导，禁止与单独布尔值发生漂移。 */
  const busy = computed(() => state.value.status === "running");
  /** 运行开始前由客户端登记标识，服务事件必须与它匹配。 */
  function begin(question: string, runId: string): void {
    state.value = { ...initialChatState(), status: "running", question, runId };
  }
  /** 所有服务事件经过同一归约器更新状态。 */
  function apply(event: ServerEvent): void {
    state.value = reduceChatEvent(state.value, event);
  }
  /** 网络断开时不能继续显示运行中；保留已收到回答以便用户复制。 */
  function fail(message: string): void {
    state.value = {
      ...state.value,
      status: "failed",
      error: message,
      tools: state.value.tools.map((tool) =>
        tool.status === "running" ? { ...tool, status: "interrupted" } : tool,
      ),
    };
  }
  /** 新建会话只清理本地运行，真实持久化会在第二、三模块实现。 */
  function reset(): void {
    state.value = initialChatState();
  }
  /** 向页面暴露状态与明确动作，不暴露网络实例。 */
  return { state, busy, begin, apply, fail, reset };
  /** 结束 Pinia 仓库定义。 */
});
