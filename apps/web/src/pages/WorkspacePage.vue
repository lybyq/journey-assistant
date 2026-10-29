<!-- 页面组合导航、账户、会话与诊断组件，网络和凭据不放在页面内部。 -->
<script setup lang="ts">
/** 页面本地视图与持久化业务状态分开。 */
import { computed, onMounted, shallowRef, watch } from 'vue';
/** 只使用对应真实动作的图标。 */
import {
  Activity,
  ArrowUpRight,
  Check,
  ChevronRight,
  LoaderCircle,
  RotateCw,
} from 'lucide-vue-next';
/** 现有导航继续保留旅行工作台与产品能力。 */
import AppSidebar from '@/components/layout/AppSidebar.vue';
/** 欢迎示例只编辑输入，不自动调用模型。 */
import WelcomePanel from '@/components/chat/WelcomePanel.vue';
/** 输入和消息展示保持独立组件。 */
import ChatComposer from '@/components/chat/ChatComposer.vue';
/** 对话仍由真实诊断事件驱动。 */
import ChatThread from '@/components/chat/ChatThread.vue';
/** 公开执行轨迹不包含隐藏推理与密钥。 */
import ExecutionPanel from '@/components/chat/ExecutionPanel.vue';
/** 读取完整模块交付状态。 */
import RoadmapPanel from '@/components/roadmap/RoadmapPanel.vue';
/** 认证表单由原生dialog管理焦点。 */
import AuthDialog from '@/components/identity/AuthDialog.vue';
/** 当前用户公开资料使用独立页面。 */
import AccountPanel from '@/components/identity/AccountPanel.vue';
/** 各业务面板由独立工作区组合。 */
import TravelStudio from '@/components/travel/TravelStudio.vue';
/** 手机与桌面共用相同的持久化会话列表。 */
import ConversationList from '@/components/identity/ConversationList.vue';
/** 聊天传输与身份存储分离，生产流绑定当前用户与会话。 */
import { useChatSession } from '@/features/chat/use-chat-session';
/** 用户数据通过单一仓库与服务端交互。 */
import { useIdentityStore } from '@/stores/identity';
/** 明确三种真实可用视图，不渲染虚假页面。 */
const activeView = shallowRef<'workspace' | 'roadmap' | 'account' | 'travel'>('workspace');
/** 界面草稿不当作已经保存的聊天历史。 */
const draft = shallowRef('');
const inspectorOpen = shallowRef(false);
const authOpen = shallowRef(false);
/** 会话请求有独立的忙碌与失败状态。 */
const historyOpen = shallowRef(false);
const conversationBusy = shallowRef(false);
const accountError = shallowRef('');
/** 读取身份仓库和诊断传输。 */
const identity = useIdentityStore();
const {
  chat,
  connection,
  health,
  networkMessage,
  connect,
  submit,
  cancel,
  history,
  nextCursor,
  historyBusy,
  loadMore,
  canSubmit,
  submitting,
  error: chatError,
} = useChatSession();
/** 当前会话名称由已验证列表派生，不在模板反复搜索。 */
const selectedTitle = computed(
  () =>
    identity.conversations.find((item) => item.id === identity.selectedId)?.title ??
    '旅行规划工作台',
);
/** 新建会话必须先在真实数据库中创建成功。 */
async function newConversation(): Promise<void> {
  /** 未登录时打开认证，不生成匿名持久化数据。 */
  if (chat.busy || submitting.value || conversationBusy.value) return;
  if (!identity.user) {
    authOpen.value = true;
    return;
  }
  /** 请求前同步标记状态，避免双击重复创建。 */
  conversationBusy.value = true;
  accountError.value = '';
  /** 成功后重置本地草稿，失败保留原状态。 */
  try {
    await identity.createConversation();
    draft.value = '';
    activeView.value = 'workspace';
  } catch (error) {
    /** 网络错误只显示安全可读消息。 */
    accountError.value = error instanceof Error ? error.message : '会话创建失败';
  } finally {
    /** 所有分支都解除忙碌状态。 */
    conversationBusy.value = false;
  }
  /** 结束新建动作。 */
}
/** 会话选择先通过后端验证资源归属，恢复消息与公开执行轨迹。 */
async function chooseConversation(id: string): Promise<void> {
  /** 运行中不切换可见会话，避免误认运行归属。 */
  if (chat.busy || submitting.value || conversationBusy.value) return;
  conversationBusy.value = true;
  accountError.value = '';
  /** 真实读取成功后才改变当前工作区。 */
  try {
    await identity.selectConversation(id);
    draft.value = '';
    activeView.value = 'workspace';
    historyOpen.value = false;
  } catch (error) {
    /** 不存在与无权访问使用相同可读失败提示。 */
    accountError.value = error instanceof Error ? error.message : '会话读取失败';
  } finally {
    /** 保证失败后可重新操作。 */
    conversationBusy.value = false;
  }
  /** 结束会话选择。 */
}
/** 改名、归档和分页统一提供真实的可见反馈。 */
async function conversationAction(action: () => Promise<void>): Promise<void> {
  /** 单次会话操作避免并发覆盖。 */
  if (conversationBusy.value || chat.busy || submitting.value) return;
  conversationBusy.value = true;
  accountError.value = '';
  /** 实际数据库成功前不假装操作已完成。 */
  try {
    await action();
  } catch (error) {
    accountError.value = error instanceof Error ? error.message : '会话操作失败';
  } finally {
    /** 任何失败都恢复操作入口。 */
    conversationBusy.value = false;
  }
  /** 结束会话动作。 */
}
/** 退出或切换账户时清空上一账户的本地临时聊天内容。 */
watch(
  () => identity.user?.id,
  (current, previous) => {
    if (current !== previous) {
      draft.value = '';
      historyOpen.value = false;
    }
  },
);
/** 页面挂载后从HttpOnly Cookie恢复账户，不读取或输出Cookie原文。 */
onMounted(() => {
  void identity.restore();
});
/** 结束页面脚本。 */
</script>
<!-- 工作台保留原有主次平面，增加真实身份和持久化入口。 -->
<template>
  <!-- 顶层按视口高度分配内部滚动。 -->
  <div class="app-shell">
    <!-- 导航只接收公开数据并发出明确用户意图。 -->
    <AppSidebar
      :active="activeView"
      :busy="chat.busy || submitting || conversationBusy"
      :user="identity.user"
      :conversations="identity.conversations"
      :selected-id="identity.selectedId"
      :has-more="Boolean(identity.nextCursor)"
      @select="activeView = $event"
      @reset="newConversation"
      @login="authOpen = true"
      @conversation="chooseConversation"
      @rename="(id, title) => conversationAction(() => identity.updateConversation(id, { title }))"
      @archive="
        (id) => conversationAction(() => identity.updateConversation(id, { archived: true }))
      "
      @more="conversationAction(identity.loadMore)"
    />
    <!-- 唯一main地标承载可操作业务页面。 -->
    <main class="main-shell">
      <!-- 当前身份与实际连接状态分开呈现。 -->
      <header class="topbar">
        <!-- 面包屑只标注存在的视图。 -->
        <div class="breadcrumbs">
          <span>我的工作区</span>
          <ChevronRight :size="12" />
          <strong>
            {{
              activeView === 'workspace'
                ? '旅行规划'
                : activeView === 'account'
                  ? '账户与偏好'
                  : activeView === 'travel'
                    ? '旅行方案'
                    : '产品能力'
            }}
          </strong>
        </div>
        <!-- 每个顶栏按钮都有真实操作和可访问名称。 -->
        <div class="top-actions">
          <!-- 窄屏通过展开列表访问真实已保存会话。 -->
          <button
            v-if="identity.user"
            class="mobile-history"
            type="button"
            :aria-expanded="historyOpen"
            @click="historyOpen = !historyOpen"
          >
            会话
          </button>
          <!-- 初始身份恢复完成后才允许提交新的登录，避免Cookie竞态。 -->
          <button
            class="account-trigger"
            type="button"
            :disabled="!identity.ready"
            @click="identity.user ? (activeView = 'account') : (authOpen = true)"
          >
            {{ identity.user?.displayName ?? (identity.ready ? '登录 / 注册' : '恢复账户中') }}
          </button>
          <!-- 只有收到真实握手后才显示在线状态。 -->
          <span :class="['connection-status', connection]" role="status">
            <i></i>
            {{
              connection === 'online'
                ? '服务已连接'
                : connection === 'connecting'
                  ? '正在连接'
                  : '服务未连接'
            }}
          </span>
          <!-- 断线有明确恢复动作，不无限自动发送请求。 -->
          <button
            v-if="connection === 'offline'"
            type="button"
            class="reconnect"
            :title="networkMessage"
            @click="connect"
          >
            <RotateCw :size="12" />
            重新连接
          </button>
          <!-- 轨迹入口只在存在执行面板的工作台视图出现。 -->
          <button
            v-if="activeView === 'workspace'"
            class="inspect-toggle"
            type="button"
            aria-label="查看执行轨迹"
            :aria-expanded="inspectorOpen"
            @click="inspectorOpen = !inspectorOpen"
          >
            <Activity :size="16" />
          </button>
          <!-- 结束顶栏操作。 -->
        </div>
        <!-- 结束顶栏。 -->
      </header>
      <!-- 持久化请求失败时提供明确反馈。 -->
      <p v-if="accountError || chatError" class="account-error" role="alert">
        {{ accountError || chatError }}
      </p>
      <!-- 手机与侧栏列表复用同一契约和后端归属校验。 -->
      <div v-if="historyOpen && identity.user" class="mobile-conversations">
        <ConversationList
          :items="identity.conversations"
          :selected-id="identity.selectedId"
          :busy="conversationBusy || chat.busy"
          :has-more="Boolean(identity.nextCursor)"
          @select="chooseConversation"
          @rename="
            (id, title) => conversationAction(() => identity.updateConversation(id, { title }))
          "
          @archive="
            (id) => conversationAction(() => identity.updateConversation(id, { archived: true }))
          "
          @more="conversationAction(identity.loadMore)"
        />
      </div>
      <!-- 主视图和执行轨迹保留主次关系。 -->
      <div class="workspace-row">
        <!-- 独立页面只负责对应模块。 -->
        <section
          class="workspace-column"
          :aria-label="
            activeView === 'workspace'
              ? '旅行对话'
              : activeView === 'account'
                ? '账户与偏好'
                : activeView === 'travel'
                  ? '旅行方案'
                  : '产品能力'
          "
        >
          <!-- 完整路线不销毁外层身份连接。 -->
          <RoadmapPanel v-if="activeView === 'roadmap'" @back="activeView = 'workspace'" />
          <!-- 账户页面只修改当前用户的公开资料。 -->
          <AccountPanel v-else-if="activeView === 'account'" @login="authOpen = true" />
          <!-- 业务工作区不混入聊天组件。 -->
          <TravelStudio v-else-if="activeView === 'travel'" @login="authOpen = true" />
          <!-- 聊天与业务工具继续通过身份绑定通道持久化。 -->
          <template v-else>
            <!-- 会话标题来自已验证元数据。 -->
            <div class="workspace-heading">
              <div>
                <span class="small-dot"></span>
                <span>{{ selectedTitle }}</span>
              </div>
              <button type="button" @click="activeView = 'roadmap'">
                规划与资料
                <ArrowUpRight :size="11" />
              </button>
            </div>
            <!-- 清楚标注当前保存范围，避免把元数据当完整消息历史。 -->
            <p v-if="identity.selectedId" class="conversation-scope">
              需求、路线、预算都可以接着聊；展开执行记录查看工具与来源。
            </p>
            <!-- 欢迎示例只填写草稿。 -->
            <div v-if="chat.state.status === 'idle' && !history.length" class="welcome-scroll">
              <WelcomePanel @choose="draft = $event" />
            </div>
            <!-- 回答仍由真实服务事件驱动。 -->
            <ChatThread
              v-else
              :state="chat.state"
              :history="history"
              :has-more="Boolean(nextCursor)"
              :loading-history="historyBusy"
              @more="loadMore"
            />
            <!-- 网络失败不会永远显示加载中。 -->
            <div v-if="connection !== 'online'" class="network-notice" role="status">
              <LoaderCircle v-if="connection === 'connecting'" :size="13" class="spin" />
              <span>{{ networkMessage }}</span>
            </div>
            <!-- 输入通过明确的props和事件接到诊断会话。 -->
            <ChatComposer
              v-model="draft"
              :busy="chat.busy || submitting"
              :pending="submitting"
              :connected="canSubmit"
              :preferred-mode="identity.profile?.preferredMode"
              @submit="
                async (message) => {
                  if (await submit(message)) draft = '';
                }
              "
              @cancel="cancel"
            />
            <!-- 结束诊断工作台。 -->
          </template>
          <!-- 结束页面主内容。 -->
        </section>
        <!-- 轨迹只显示公开步骤与脱敏结果。 -->
        <ExecutionPanel
          v-if="activeView === 'workspace'"
          :state="chat.state"
          :health="health"
          :mobile-open="inspectorOpen"
          @close="inspectorOpen = false"
        />
        <!-- 结束内容行。 -->
      </div>
      <!-- 页脚标注当前交付版本。 -->
      <footer class="app-footer">
        <span>
          <Check :size="10" />
          多轮历史 · 实时保存 · 断线恢复
        </span>
        <span>
          行也 JOURNEY
          <i>·</i>
          PLAN WITH CLARITY
        </span>
      </footer>
      <!-- 结束主地标。 -->
    </main>
    <!-- 认证表单不保存密码到仓库，原生dialog负责焦点恢复。 -->
    <AuthDialog :open="authOpen" @close="authOpen = false" />
    <!-- 结束工作台布局。 -->
  </div>
  <!-- 结束页面模板。 -->
</template>
<!-- 保留现有布局与设计令牌，仅增加身份与存储相关样式。 -->
<style scoped>
/** 当前账户入口不与主操作争抢层级。 */
.account-trigger {
  font-size: 13px;
  color: var(--forest);
  max-width: 100px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
/** 已保存会话的真实范围明确说明。 */
.conversation-scope {
  font-size: 13px;
  color: var(--muted);
  margin: -7px 0 16px;
  line-height: 1.8;
}
/** 请求错误在工作区顶部可见，不只写控制台。 */
.account-error {
  color: #9b4d33;
  margin: 0;
  padding: 10px 25px;
  background: #fbefe7;
  font-size: 14px;
}
/** 桌面通过侧栏使用会话，手机使用顶栏入口。 */
.mobile-history,
.mobile-conversations {
  display: none;
}
/** 移动端保留所有真实账户和会话操作。 */
@media (max-width: 760px) {
  .mobile-history {
    display: block;
    color: var(--forest);
    font-size: 13px;
  }
  .mobile-conversations {
    display: block;
    padding: 0 20px 10px;
    border-bottom: 1px solid var(--line);
  }
  .account-trigger {
    font-size: 13px;
    max-width: 65px;
  }
}
/** 桌面端建立三列工作平面。 */
.app-shell {
  display: flex;
  height: 100dvh;
  min-height: 600px;
  background: var(--paper);
  overflow: hidden;
}
/** 主内容按顶栏、工作区、页脚自然分配高度。 */
.main-shell {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  flex: 1;
}
/** 顶部导航使用细分隔线保持界面轻量。 */
.topbar {
  height: 72px;
  min-height: 72px;
  padding: 0 34px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--line);
}
/** 面包屑只展示真正存在的视图。 */
.breadcrumbs {
  display: flex;
  align-items: center;
  gap: 13px;
  color: #929b87;
  font-size: 13px;
}
/** 当前视图用字重而非厚重背景强调。 */
.breadcrumbs strong {
  font-weight: 500;
  color: #57694e;
}
/** 顶部连接与恢复动作对齐。 */
.top-actions {
  display: flex;
  align-items: center;
  gap: 16px;
}
/** 连接状态同时使用文字和状态点。 */
.connection-status {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #8b957e;
}
/** 未就绪使用中性灰点。 */
.connection-status i {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #b3bba7;
}
/** 只有实际收到 session.ready 才呈现在线绿色。 */
.connection-status.online i {
  background: #739760;
  box-shadow: 0 0 0 3px #73976012;
}
/** 重连动作拥有可见文本，不使用无意义装饰按钮。 */
.reconnect {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
  color: var(--forest);
}
/** 执行面板切换仅在窄屏出现。 */
.inspect-toggle {
  display: none;
}
/** 工作区分配剩余高度，限制内部滚动范围。 */
.workspace-row {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
}
/** 主列留出均匀页边，不用装饰框围住整个工作面。 */
.workspace-column {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  min-height: 0;
  padding: 26px 36px 18px;
}
/** 小标题用于当前工作区定位。 */
.workspace-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  color: #8a957e;
  margin: 0 0 21px;
  flex-shrink: 0;
}
/** 小标题和阶段操作维持自然排列。 */
.workspace-heading > div,
.workspace-heading button {
  display: flex;
  align-items: center;
  gap: 7px;
}
/** 标题圆点只作静态层级辅助。 */
.small-dot {
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #8da379;
}
/** 阶段操作比主输入更低权重。 */
.workspace-heading button {
  font-size: 12px;
  color: #8b977d;
}
/** 首次欢迎区域独立滚动，避免短屏遮住输入。 */
.welcome-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-bottom: 20px;
  scrollbar-width: thin;
}
/** 网络问题明确显示在输入上方。 */
.network-notice {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  font-size: 13px;
  color: #8b7952;
  padding: 7px 0 10px;
}
/** 页脚压低对比，不与聊天内容竞争。 */
.app-footer {
  min-height: 31px;
  padding: 0 29px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  color: #97a08c;
  font-size: 12px;
  letter-spacing: 0.2px;
}
/** 页脚承诺仅指已经具备的底座展示能力。 */
.app-footer > span:first-child {
  display: flex;
  align-items: center;
  gap: 6px;
}
/** 品牌分隔符不使用装饰性强调。 */
.app-footer i {
  font-style: normal;
  margin: 0 6px;
}
/** 中屏压缩页边，保留正文空间。 */
@media (max-width: 1350px) {
  .workspace-column {
    padding: 24px 26px 17px;
  }
  .topbar {
    padding: 0 27px;
  }
}
/** 轨迹折叠后给出真正可用的打开入口。 */
@media (max-width: 1050px) {
  .inspect-toggle {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    color: var(--forest);
  }
}
/** 手机使用顶部导航与纵向工作台，输入底部考虑安全区。 */
@media (max-width: 760px) {
  .app-shell {
    flex-direction: column;
    min-height: 0;
  }
  .topbar {
    height: 52px;
    min-height: 52px;
    padding: 0 20px;
  }
  .breadcrumbs {
    font-size: 13px;
    gap: 8px;
  }
  .top-actions {
    gap: 8px;
  }
  .connection-status {
    font-size: 12px;
  }
  .workspace-column {
    padding: 19px 18px max(14px, env(safe-area-inset-bottom));
  }
  .workspace-heading {
    margin-bottom: 16px;
    font-size: 12px;
  }
  .app-footer {
    display: none;
  }
  .welcome-scroll {
    padding-bottom: 18px;
  }
}
/** 结束工作台布局样式。 */

/** 主画布留给旅行内容，连接状态和页脚保持清楚但不争夺主视觉。 */
.topbar {
  background: #fffef8c9;
  backdrop-filter: blur(16px);
  height: 76px;
  min-height: 76px;
}
.breadcrumbs {
  font-size: 14px;
}
.breadcrumbs strong {
  font-weight: 600;
}
.connection-status {
  font-size: 13px;
}
.account-trigger {
  font-size: 14px;
  max-width: 170px;
}
.reconnect {
  font-size: 13px;
}
.workspace-column {
  padding: 25px 30px 18px;
  background: radial-gradient(ellipse at 100% 0, #eaf1df88, transparent 60%);
}
.workspace-heading {
  font-size: 13px;
  margin-bottom: 16px;
}
.workspace-heading button {
  font-size: 12px;
}
.conversation-scope {
  font-size: 13px;
}
.app-footer {
  font-size: 12px;
  min-height: 37px;
  background: #f7faf0;
}
.network-notice {
  font-size: 13px;
}
@media (min-width: 1051px) and (max-width: 1450px) {
  .workspace-column {
    padding-left: 21px;
    padding-right: 21px;
  }
}
@media (max-width: 760px) {
  .topbar {
    height: 54px;
    min-height: 54px;
    padding: 0 16px;
  }
  .breadcrumbs {
    font-size: 12px;
    gap: 6px;
  }
  .account-trigger {
    font-size: 12px;
    max-width: 100px;
  }
  .connection-status {
    font-size: 12px;
  }
  .workspace-column {
    padding: 15px 12px 16px;
  }
  .conversation-scope {
    font-size: 12px;
  }
  .workspace-heading {
    font-size: 12px;
    margin-bottom: 10px;
  }
}
</style>
