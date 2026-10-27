<!-- 原生模态对话框提供焦点限制、Esc关闭和关闭后焦点恢复。 -->
<script setup lang="ts">
/** 使用原生dialog引用和生命周期清理密码草稿。 */
import { computed, onUnmounted, reactive, shallowRef, useTemplateRef, watch } from 'vue';
/** 登录表单沿用品牌的线性图标。 */
import { ArrowRight, KeyRound, LoaderCircle, Route, X } from 'lucide-vue-next';
/** 密码与邮箱在网页边界也使用共享校验规则。 */
import { loginSchema, registerSchema } from '@journey/contracts';
/** 账户操作由仓库统一管理，密码不存入仓库。 */
import { useIdentityStore } from '@/stores/identity';
/** 父级只决定是否显示模态层。 */
const props = defineProps<{ open: boolean }>();
/** 关闭由事件通知父级，不反向修改props。 */
const emit = defineEmits<{ close: [] }>();
/** 模态与表单状态只在此组件存在。 */
const dialog = useTemplateRef<HTMLDialogElement>('dialog'); const mode = shallowRef<'login' | 'register'>('login'); const form = reactive({ email: '', password: '', displayName: '' }); const localError = shallowRef('');
/** 获取公开认证操作和忙碌状态。 */
const identity = useIdentityStore();
/** 错误优先展示当前表单校验结果。 */
const error = computed(() => localError.value || identity.error);
/** props变更驱动原生modal状态，关闭立即清空密码。 */
watch(() => props.open, (open) => { if (open) { localError.value = ''; identity.error = ''; dialog.value?.showModal(); } else { dialog.value?.close(); form.password = ''; } }, { flush: 'post' });
/** 切换表单模式时不遗留密码与错误。 */
function switchMode(): void { mode.value = mode.value === 'login' ? 'register' : 'login'; form.password = ''; localError.value = ''; identity.error = ''; }
/** 提交前先校验，注册失败不将密码放进可观察日志。 */
async function submit(): Promise<void> { localError.value = ''; const input = mode.value === 'login' ? { email: form.email, password: form.password } : { ...form }; const parsed = (mode.value === 'login' ? loginSchema : registerSchema).safeParse(input); if (!parsed.success) { localError.value = mode.value === 'register' ? '请填写有效邮箱、显示名和15～128位密码。' : '请填写有效邮箱与密码。'; return; } try { await identity.authenticate(mode.value, parsed.data); form.password = ''; emit('close'); } catch { form.password = ''; } }
/** 卸载时不保留密码草稿。 */
onUnmounted(() => { form.password = ''; });
/** 结束认证对话框脚本。 */
</script>
<!-- 表单支持密码管理器与原生键盘提交。 -->
<template>
  <!-- 原生cancel关闭必须同步父级状态。 -->
  <dialog ref="dialog" class="auth-dialog" aria-labelledby="auth-title" @cancel.prevent="!identity.busy && emit('close')">
    <!-- 运行中禁用关闭避免表单误判提交结果。 -->
    <button class="dialog-close" type="button" :disabled="identity.busy" aria-label="关闭登录窗口" @click="emit('close')"><X :size="19" /></button>
    <!-- 旅行品牌与身份用途统一。 -->
    <div class="auth-brand"><Route :size="26" /><span>行也 JOURNEY</span></div>
    <!-- 清晰区分登录与注册状态。 -->
    <h2 id="auth-title">{{ mode === 'login' ? '继续你的下一程' : '为旅程留一个位置' }}</h2>
    <!-- 不把密码登录描述成已验证邮箱所有权。 -->
    <p class="auth-intro">登录后保存旅行偏好，管理自己的旅行会话。</p>
    <!-- 所有输入拥有可见标签和自动填充语义。 -->
    <form @submit.prevent="submit">
      <!-- 显示名仅在注册时提交。 -->
      <label v-if="mode === 'register'">怎么称呼你<input v-model="form.displayName" name="displayName" autocomplete="nickname" maxlength="50" required :disabled="identity.busy" /></label>
      <!-- 邮箱规范化由共享schema与数据库共同保证。 -->
      <label>邮箱<input v-model="form.email" type="email" name="email" autocomplete="email" maxlength="254" required :disabled="identity.busy" placeholder="you@example.com" /></label>
      <!-- 密码不会写入本地存储；允许密码管理器生成长口令。 -->
      <label>密码<input v-model="form.password" type="password" name="password" :autocomplete="mode === 'login' ? 'current-password' : 'new-password'" :minlength="mode === 'register' ? 15 : 1" maxlength="128" required :disabled="identity.busy" :placeholder="mode === 'register' ? '至少15个字符，推荐使用长口令' : '输入你的密码'" /></label>
      <!-- 失败通过文字与alert通知，不仅依靠颜色。 -->
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <!-- 按钮只在真实网络操作时显示加载态。 -->
      <button class="auth-submit" type="submit" :disabled="identity.busy"><LoaderCircle v-if="identity.busy" class="spin" :size="17" /><span>{{ identity.busy ? '正在连接账户…' : mode === 'login' ? '登录行也' : '创建账户' }}</span><ArrowRight v-if="!identity.busy" :size="16" /></button>
    <!-- 结束认证表单。 -->
    </form>
    <!-- 注册入口与登录入口相互切换，不提供未实现的找回密码假按钮。 -->
    <button class="switch-mode" type="button" :disabled="identity.busy" @click="switchMode">{{ mode === 'login' ? '还没有账户？创建一个' : '已有账户？直接登录' }}</button>
    <!-- 简短说明凭据边界，帮助用户理解页面刷新后的恢复。 -->
    <div class="auth-note"><KeyRound :size="12" /><span>登录会话由安全 Cookie 管理，密码不会保存在网页。</span></div>
  <!-- 结束原生模态层。 -->
  </dialog>
<!-- 结束认证模板。 -->
</template>
<!-- 身份界面沿用森林绿与纸白，减少浮夸的权限相关装饰。 -->
<style scoped>
/** 模态宽度在桌面与手机都保留可读边距。 */
.auth-dialog { border: 1px solid var(--line); border-radius: 18px; padding: 36px; width: min(440px, calc(100vw - 32px)); color: var(--ink); background: var(--paper); box-shadow: 0 25px 90px #0c2b2b35; }
/** 暗背景强调当前焦点表单，原生dialog负责限制键盘焦点。 */
.auth-dialog::backdrop { background: #163a3180; backdrop-filter: blur(5px); }
/** 关闭按钮保持充足触达尺寸。 */
.dialog-close { position: absolute; right: 15px; top: 15px; width: 34px; height: 34px; display: grid; place-items: center; color: var(--muted); }
/** 品牌标识压低权重，让用户先读表单目的。 */
.auth-brand { display: flex; align-items: center; gap: 10px; font-size: 11px; letter-spacing: 2px; color: var(--forest); margin-bottom: 28px; }
/** 标题与工作台的中文宋体保持一致。 */
h2 { font: 500 25px/1.5 'STSong', 'Songti SC', serif; color: var(--forest); margin: 0 0 9px; }
/** 简介清楚说明持久化范围。 */
.auth-intro { font-size: 12px; color: var(--muted); line-height: 1.8; margin-bottom: 26px; }
/** 每个字段标签与输入垂直排列。 */
label { display: grid; gap: 8px; font-size: 12px; margin-bottom: 17px; color: #5b6d54; }
/** 原生输入保留密码管理器和移动端键盘能力。 */
input { width: 100%; border: 1px solid #d5ddcf; border-radius: 8px; padding: 12px; font-size: 13px; color: var(--ink); background: white; outline: none; }
/** 键盘焦点明确可见。 */
input:focus { border-color: #7c9d7c; box-shadow: 0 0 0 3px #a4bda220; }
/** 主动作使用单一森林绿。 */
.auth-submit { display: flex; align-items: center; justify-content: center; gap: 11px; width: 100%; padding: 13px; color: #fff; background: var(--forest); border-radius: 8px; font-size: 13px; }
/** 注册与登录切换不与主动作争夺权重。 */
.switch-mode { display: block; margin: 20px auto; font-size: 12px; color: var(--forest); text-decoration: underline; text-underline-offset: 4px; }
/** 错误文字保留自然行高。 */
.form-error { color: #9b4f34; font-size: 12px; line-height: 1.7; }
/** Cookie说明采用低权重分隔行。 */
.auth-note { display: flex; gap: 7px; font-size: 10px; color: #8a957f; border-top: 1px solid var(--line); padding-top: 17px; line-height: 1.8; }
/** 手机缩小模态边距而不缩小字段触达区域。 */
@media (max-width: 760px) { .auth-dialog { padding: 30px 23px; } }
/** 结束认证样式。 */
</style>
