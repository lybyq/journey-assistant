<!-- 账户面板负责公开身份与基础旅行资料，不处理模型或消息。 -->
<script setup lang="ts">
/** 本地编辑草稿与服务端资料分开，保存前不修改仓库值。 */
import { reactive, shallowRef, watch } from 'vue';
/** 真实保存、退出和加载状态使用统一图标。 */
import { Check, LoaderCircle, LogOut, Save, UserRound } from 'lucide-vue-next';
/** 旅行模式和节奏来自共享基础资料类型。 */
import type { TravelerProfile } from '@journey/contracts';
/** 读取身份及持久化操作。 */
import { useIdentityStore } from '@/stores/identity';
/** 归档会话提供可恢复入口，避免归档后只能通过API找回。 */
import ArchivedConversations from './ArchivedConversations.vue';
/** 未登录用户可从这里打开认证表单。 */
const emit = defineEmits<{ login: [] }>();
/** 当前用户由单一仓库管理。 */
const identity = useIdentityStore();
/** 编辑草稿只包含本模块允许修改的公开字段。 */
const form = reactive({
  displayName: '',
  homeCity: '',
  preferredMode: 'independent' as TravelerProfile['preferredMode'],
  pace: 'balanced' as TravelerProfile['pace'],
});
/** 保存反馈仅在服务端确认后显示。 */
const saved = shallowRef(false);
const error = shallowRef('');
/** 用户或资料变化时同步编辑草稿，账户切换不会带入上一用户资料。 */
watch(
  () => [identity.user, identity.profile] as const,
  ([user, profile]) => {
    form.displayName = user?.displayName ?? '';
    form.homeCity = profile?.homeCity ?? '';
    form.preferredMode = profile?.preferredMode ?? 'independent';
    form.pace = profile?.pace ?? 'balanced';
    saved.value = false;
  },
  { immediate: true },
);
/** 保存完成后保持在当前页面，并给出明确结果。 */
async function save(): Promise<void> {
  saved.value = false;
  error.value = '';
  try {
    await identity.saveProfile(form.displayName.trim(), {
      homeCity: form.homeCity.trim(),
      preferredMode: form.preferredMode,
      pace: form.pace,
    });
    saved.value = true;
  } catch {
    error.value = identity.error;
  }
}
/** 退出失败时保留真实登录状态，不能只在前端假装服务器已经撤销。 */
async function logout(all: boolean): Promise<void> {
  error.value = '';
  try {
    await identity.logout(all);
  } catch {
    error.value = identity.error;
  }
}
/** 结束账户面板脚本。 */
</script>
<!-- 独立滚动区域不会遮挡工作台导航。 -->
<template>
  <!-- 标题与表单保持阅读型布局。 -->
  <section class="account-panel">
    <!-- 提供明确的资料入口，不混入营销内容。 -->
    <header>
      <span class="eyebrow">YOUR TRAVEL PROFILE</span>
      <h1>账户与旅行偏好</h1>
      <p>资料保存在你的账户下，换一个设备也能继续使用。</p>
    </header>
    <!-- 未登录时不渲染虚假的账户资料。 -->
    <div v-if="!identity.user" class="signed-out">
      <UserRound :size="28" />
      <h2>先登录，再保存旅行偏好</h2>
      <p>每个账户的资料和旅行会话相互独立。</p>
      <button class="primary" type="button" @click="emit('login')">登录 / 创建账户</button>
    </div>
    <!-- 所有资料来自后端已认证的当前用户。 -->
    <template v-else>
      <!-- 邮箱只读，本模块不把修改邮箱当成验证邮箱所有权。 -->
      <div class="account-summary">
        <span class="avatar">{{ identity.user.displayName.slice(0, 1) }}</span>
        <div>
          <strong>{{ identity.user.displayName }}</strong>
          <span>{{ identity.user.email }}</span>
        </div>
        <small>账户已登录</small>
      </div>
      <!-- 表单仅更新当前用户可修改的基础资料。 -->
      <form class="profile-form" @submit.prevent="save">
        <!-- 显示名长度与后端一致。 -->
        <label>
          显示名
          <input
            v-model="form.displayName"
            required
            maxlength="50"
            autocomplete="nickname"
            :disabled="identity.busy"
          />
        </label>
        <!-- 城市是偏好信息，不获取精确定位。 -->
        <label>
          常用出发城市
          <input
            v-model="form.homeCity"
            maxlength="80"
            placeholder="例如：杭州"
            :disabled="identity.busy"
          />
        </label>
        <!-- 选择值直接对应共享枚举。 -->
        <label>
          偏好出行方式
          <select v-model="form.preferredMode" :disabled="identity.busy">
            <option value="independent">自由行</option>
            <option value="driving">自驾游</option>
            <option value="group">跟团游</option>
          </select>
        </label>
        <!-- 旅行节奏只是基础偏好，真正的行程约束在旅行需求实现。 -->
        <label>
          旅行节奏
          <select v-model="form.pace" :disabled="identity.busy">
            <option value="relaxed">慢慢走，多留一点空白</option>
            <option value="balanced">游玩与休息平衡</option>
            <option value="intensive">紧凑一些，多看几个地方</option>
          </select>
        </label>
        <!-- 错误与成功都有明确文本反馈。 -->
        <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="saved" class="saved" role="status">
          <Check :size="14" />
          偏好已保存到你的账户
        </p>
        <!-- 按钮只在真实请求期间禁用。 -->
        <button class="primary" type="submit" :disabled="identity.busy">
          <LoaderCircle v-if="identity.busy" :size="15" class="spin" />
          <Save v-else :size="15" />
          保存资料
        </button>
        <!-- 结束资料表单。 -->
      </form>
      <!-- 当前设备与全部设备退出具有不同且明确的动作名称。 -->
      <ArchivedConversations />
      <!-- 退出操作在所有可保存资料与归档操作之后。 -->
      <div class="signout-actions">
        <button type="button" :disabled="identity.busy" @click="logout(false)">
          <LogOut :size="14" />
          退出当前登录
        </button>
        <button type="button" :disabled="identity.busy" @click="logout(true)">退出全部设备</button>
      </div>
      <!-- 结束已认证分支。 -->
    </template>
    <!-- 结束账户页面。 -->
  </section>
  <!-- 结束账户模板。 -->
</template>
<!-- 表单保持现有森林绿主题，字段有明确可访问焦点。 -->
<style scoped>
/** 页面留出自然边距并支持短屏独立滚动。 */
.account-panel {
  max-width: 740px;
  width: 100%;
  margin: 0 auto;
  overflow-y: auto;
  padding: 12px 4px 35px;
  scrollbar-width: thin;
}
/** 眉题延续工作台的轻量编辑风格。 */
.eyebrow {
  font-size: 12px;
  letter-spacing: 2px;
  color: #7b8b79;
}
/** 标题使用中文宋体建立统一层级。 */
h1 {
  font:
    500 29px/1.5 'STSong',
    'Songti SC',
    serif;
  color: var(--forest);
  margin: 14px 0 10px;
}
/** 说明保持可读字号。 */
header p,
.signed-out p {
  font-size: 14px;
  line-height: 1.8;
  color: var(--muted);
}
/** 账户身份以行布局呈现，不添加多层卡片。 */
.account-summary {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 31px 0;
  padding: 22px 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
/** 字符头像不向第三方发送用户邮箱来获取头像。 */
.avatar {
  display: grid;
  place-items: center;
  width: 45px;
  height: 45px;
  border-radius: 50%;
  background: #e3ebdb;
  color: var(--forest);
  font-size: 19px;
}
/** 身份名称和邮箱有清晰文字层次。 */
.account-summary strong,
.account-summary div span {
  display: block;
  font-size: 14px;
}
/** 邮箱辅助信息可复制但不被用作隐私追踪参数。 */
.account-summary div span {
  color: var(--muted);
  font-size: 13px;
  margin-top: 7px;
}
/** 登录状态只表达当前身份，不宣称邮箱已经验证。 */
.account-summary small {
  margin-left: auto;
  color: #7a916b;
  font-size: 13px;
}
/** 表单采用两列，手机自动单列。 */
.profile-form {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 21px;
}
/** 标签与字段保持稳定垂直距离。 */
label {
  display: grid;
  gap: 9px;
  color: #607456;
  font-size: 14px;
}
/** 原生字段支持键盘和移动端选择器。 */
input,
select {
  width: 100%;
  padding: 12px;
  border: 1px solid #d8dfd1;
  border-radius: 7px;
  background: #fff;
  color: var(--ink);
  font-size: 14px;
  outline: none;
}
/** 聚焦时显示清晰边界。 */
input:focus,
select:focus {
  border-color: #7c9d7c;
  box-shadow: 0 0 0 3px #a4bda220;
}
/** 主按钮具有明确操作含义。 */
.primary {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 9px;
  width: fit-content;
  padding: 12px 20px;
  color: #fff;
  background: var(--forest);
  border-radius: 7px;
  font-size: 14px;
}
/** 保存和错误反馈跨越整个表单宽度。 */
.form-error,
.saved {
  grid-column: 1 / -1;
  font-size: 14px;
  margin: 0;
  line-height: 1.7;
}
/** 错误以文字配色共同表达。 */
.form-error {
  color: #984c35;
}
/** 保存成功使用真实服务确认。 */
.saved {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #4f7852;
}
/** 退出动作与常规保存分隔，避免误点击。 */
.signout-actions {
  display: flex;
  justify-content: space-between;
  border-top: 1px solid var(--line);
  margin-top: 36px;
  padding-top: 23px;
}
/** 次要退出操作不抢占主动作。 */
.signout-actions button {
  display: flex;
  align-items: center;
  gap: 7px;
  color: #7e816d;
  font-size: 13px;
}
/** 未登录空态明确引导，而不是显示占位用户。 */
.signed-out {
  text-align: center;
  padding: 65px 15px;
  color: #829773;
}
/** 空态标题低于页面主标题。 */
.signed-out h2 {
  font-size: 17px;
  font-weight: 500;
  color: var(--forest);
}
/** 空态按钮居中显示。 */
.signed-out .primary {
  margin-top: 18px;
}
/** 手机表单改成单列，保持可点击尺寸。 */
@media (max-width: 760px) {
  .profile-form {
    grid-template-columns: 1fr;
  }
  h1 {
    font-size: 25px;
  }
  .account-summary small {
    display: none;
  }
}
/** 结束账户样式。 */
</style>
