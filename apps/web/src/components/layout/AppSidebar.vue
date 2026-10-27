<!-- 导航栏只负责工作区导航和当前阶段提示。 -->
<script setup lang="ts">
/** 使用统一的轻量图标传达导航含义。 */
import { ArrowUpRight, Compass, Map, Plus, Route, Sparkles, UserRound } from 'lucide-vue-next';
/** 仅接收公开用户与会话，不读取密码或令牌。 */
import type { Conversation, PublicUser } from '@journey/contracts';
/** 持久化列表通过事件交由页面执行网络操作。 */
import ConversationList from '@/components/identity/ConversationList.vue';
/** 当前视图由父页面管理，导航栏不私自修改业务状态。 */
defineProps<{ active: 'workspace' | 'roadmap' | 'account'; busy: boolean; user: PublicUser | null; conversations: Conversation[]; selectedId: string | null; hasMore: boolean }>();
/** 显式声明新建与导航意图，遵循 props 向下、事件向上。 */
const emit = defineEmits<{ select: [view: 'workspace' | 'roadmap' | 'account']; reset: []; login: []; conversation: [id: string]; rename: [id: string, title: string]; archive: [id: string]; more: [] }>();
/** 结束导航脚本。 */
</script>
<!-- 桌面为侧边栏，移动端收缩为顶部品牌导航。 -->
<template>
  <!-- 使用导航地标帮助键盘与读屏器定位。 -->
  <aside class="sidebar" aria-label="主导航">
    <!-- 品牌字标保持独立，不依赖摄影或图标才能识别产品。 -->
    <a class="brand" href="/" aria-label="行也首页"><span class="brand-mark"><Route :size="24" :stroke-width="1.8" /></span><span>行也<span class="brand-en">JOURNEY</span></span></a>
    <!-- 新建只重置当前本地会话，运行中禁用以免丢失任务状态。 -->
    <button class="new-chat" :disabled="busy" type="button" @click="emit('reset')"><Plus :size="17" />新建对话<span class="key-hint">＋</span></button>
    <!-- 两个入口都对应真实可访问的界面。 -->
    <nav class="nav-list">
      <!-- 激活状态同时提供视觉与辅助技术标识。 -->
      <button type="button" :class="['nav-item', { active: active === 'workspace' }]" :aria-current="active === 'workspace' ? 'page' : undefined" @click="emit('select', 'workspace')"><Compass :size="18" />旅行工作台</button>
      <!-- 模块路线会显示完整规划与实现状态。 -->
      <button type="button" :class="['nav-item', { active: active === 'roadmap' }]" :aria-current="active === 'roadmap' ? 'page' : undefined" @click="emit('select', 'roadmap')"><Map :size="18" />模块路线<span class="nav-count">14</span></button>
    <!-- 结束主导航列表。 -->
      <!-- 基础资料使用真实的受保护账户接口。 -->
      <button type="button" :class="['nav-item', { active: active === 'account' }]" :aria-current="active === 'account' ? 'page' : undefined" @click="emit('select', 'account')"><UserRound :size="18" />账户与偏好</button>
    </nav>
    <!-- 当前会话没有持久化，因此不填充虚构旅行历史。 -->
    <div class="history-note"><span class="section-label">已保存的会话</span><ConversationList v-if="user" :items="conversations" :selected-id="selectedId" :busy="busy" :has-more="hasMore" @select="emit('conversation', $event)" @rename="(id, title) => emit('rename', id, title)" @archive="emit('archive', $event)" @more="emit('more')" /><template v-else><p>登录后，保存你的<br />旅行会话与出行偏好。</p><button class="history-login" type="button" @click="emit('login')">登录账户 →</button></template></div>
    <!-- 阶段说明让用户清楚现在能够实际使用的能力。 -->
    <div class="foundation-note"><Sparkles :size="17" /><span>基础连接已开放</span><p>先验证交互链路，再逐步接入<br />真实的旅行数据与智能体。</p><button type="button" @click="emit('select', 'roadmap')">查看模块路线<ArrowUpRight :size="14" /></button></div>
    <!-- 项目状态没有虚构登录用户与头像。 -->
    <button type="button" class="sidebar-footer" @click="user ? emit('select', 'account') : emit('login')"><span class="workspace-avatar">{{ user?.displayName.slice(0, 1) ?? '行' }}</span><div><strong>{{ user?.displayName ?? '登录行也' }}</strong><span>用户与数据 · 02 / 14</span></div><span class="status-dot"></span></button>
  <!-- 结束导航侧栏。 -->
  </aside>
<!-- 结束导航模板。 -->
</template>
<!-- 导航外观使用暖灰与森林绿，压低装饰元素的权重。 -->
<style scoped>
/** 侧栏在桌面维持完整高度，采用自然纵向布局。 */
.sidebar { width: 238px; flex-shrink: 0; background: #eeeee7; display: flex; flex-direction: column; padding: 32px 20px 20px; border-right: 1px solid var(--line); }
/** 字标拥有明确视觉层级。 */
.brand { display: flex; align-items: center; gap: 11px; margin: 0 12px 34px; color: var(--forest); font-family: 'STSong', 'Songti SC', serif; font-size: 29px; font-weight: 700; text-decoration: none; letter-spacing: 3px; }
/** 路线图标作为品牌的辅助识别。 */
.brand-mark { display: grid; place-items: center; width: 38px; height: 40px; }
/** 英文副标使用独立的小字号和宽字距。 */
.brand-en { display: block; font-family: var(--font-body); font-size: 8px; letter-spacing: 3.2px; margin-top: 2px; }
/** 新建入口是侧栏最主要的操作。 */
.new-chat { display: flex; align-items: center; gap: 10px; width: 100%; background: var(--forest); color: #fff; border-radius: 9px; padding: 13px 14px; font-size: 13px; transition: background .2s, transform .2s; }
/** 按下时给出小幅位移反馈。 */
.new-chat:active { transform: translateY(1px); }
/** 提示符靠右排列而不挤压主文案。 */
.key-hint { margin-left: auto; color: #a1b5ab; font-size: 16px; }
/** 导航列表以固定间距形成可扫描节奏。 */
.nav-list { display: grid; gap: 6px; margin-top: 28px; }
/** 未激活导航保持较低对比。 */
.nav-item { display: flex; align-items: center; gap: 11px; padding: 12px 13px; width: 100%; border-radius: 7px; color: #69736a; font-size: 13px; transition: background .2s, color .2s; }
/** 激活与悬停都提供可见背景反馈。 */
.nav-item:hover, .nav-item.active { background: #e0e5db; color: var(--forest); }
/** 数量是路线信息，而非不存在的消息通知。 */
.nav-count { margin-left: auto; font-size: 10px; color: #75816e; }
/** 历史空态不伪造已有旅行记录。 */
.history-note { margin: 27px 8px; min-height: 0; overflow-y: auto; }
/** 未登录时提供可用的身份入口。 */
.history-login { font-size: 11px; color: var(--forest); padding: 6px 0; }
/** 小节名称使用统一的次要文本样式。 */
.section-label { color: #7c8378; font-size: 10px; letter-spacing: 1px; }
/** 空态文字使用轻盈的自然行高。 */
.history-note p { color: #737b6e; font-size: 12px; line-height: 1.9; margin: 17px 0 9px; }
/** 技术阶段信息不与产品操作争夺注意力。 */
.history-detail { font-size: 10px; color: #8b9186; }
/** 说明区域靠近侧栏底部，但不使用浮夸卡片网格。 */
.foundation-note { margin: auto 10px 22px; padding-top: 22px; border-top: 1px solid #dce0d5; color: var(--forest); font-size: 12px; }
/** 图标和标题保持基线对齐。 */
.foundation-note > svg { vertical-align: middle; margin-right: 8px; }
/** 说明段落降低字体对比。 */
.foundation-note p { color: #788070; font-size: 11px; line-height: 1.9; margin-top: 12px; }
/** 查看路线动作清晰可点击。 */
.foundation-note button { display: flex; align-items: center; gap: 7px; font-size: 11px; margin-top: 14px; }
/** 底部显示工作区身份，而不是虚构登录账户。 */
.sidebar-footer { display: flex; gap: 10px; align-items: center; padding: 16px 8px 0; border-top: 1px solid #dce0d5; }
/** 工作区字标替代没有来源的用户头像。 */
.workspace-avatar { width: 32px; height: 32px; display: grid; place-items: center; background: #d9e0d3; border-radius: 50%; color: var(--forest); font-family: serif; }
/** 工作区名称只占一行。 */
.sidebar-footer strong { display: block; font-size: 11px; font-weight: 500; }
/** 当前交付阶段使用辅助字号。 */
.sidebar-footer div > span { display: block; font-size: 9px; color: #838a7c; margin-top: 4px; }
/** 状态点只代表当前工程阶段，不冒充服务器在线。 */
.status-dot { width: 5px; height: 5px; border-radius: 50%; background: #90a380; margin-left: auto; }
/** 中等屏幕收窄侧栏而不隐藏导航。 */
@media (max-width: 1200px) { .sidebar { width: 206px; padding: 28px 14px 18px; } }
/** 手机采用品牌栏与横向导航，保留真实可点击的主要入口。 */
@media (max-width: 760px) { .sidebar { width: 100%; padding: 14px 18px 0; border-right: 0; border-bottom: 1px solid var(--line); } .brand { margin: 0; font-size: 24px; gap: 7px; } .brand-en { font-size: 7px; } .brand-mark { width: 30px; } .new-chat { position: absolute; top: 21px; right: 18px; width: auto; padding: 9px 12px; font-size: 11px; } .key-hint { display: none; } .nav-list { display: flex; margin-top: 14px; gap: 8px; } .nav-item { width: auto; padding: 10px 12px; font-size: 12px; border-radius: 7px 7px 0 0; } .nav-count { margin-left: 12px; } .history-note, .foundation-note, .sidebar-footer { display: none; } }
/** 结束导航样式。 */
</style>
