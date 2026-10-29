/** Pinia统一管理表单与当前用户，密码不进入仓库。 */
import { defineStore } from 'pinia';
/** 使用浅层状态避免代理网络返回的大对象。 */
import { computed, shallowRef, watch } from 'vue';
/** 用户、基础偏好与会话均由共享schema验证。 */
import {
  userSchema,
  profileSchema,
  conversationListSchema,
  conversationSchema,
  type TravelerProfile,
  type Conversation,
} from '@journey/contracts';
/** 网络与凭据处理集中在服务层。 */
import {
  acceptIdentity,
  ApiError,
  authenticatedRequest,
  authRequest,
  clearIdentity,
  currentUser,
  refreshIdentity,
} from '@/services/http-client';
/** 身份与会话仓库只保存当前登录用户的公开数据。 */
export const useIdentityStore = defineStore('identity', () => {
  /** user直接绑定网络层的单一公开身份源。 */
  const user = currentUser;
  /** 保存当前用户基础资料及会话列表，退出时立即清理。 */
  const profile = shallowRef<TravelerProfile | null>(null);
  const conversations = shallowRef<Conversation[]>([]);
  const selectedId = shallowRef<string | null>(null);
  /** 分页游标由服务端生成，不在前端猜测。 */
  const nextCursor = shallowRef<string | null>(null);
  /** 数据切换代数阻止登出后迟到的请求把上个账户资料写回来。 */
  let generation = 0;
  /** busy仅描述账户提交，聊天运行拥有独立状态。 */
  const busy = shallowRef(false);
  const ready = shallowRef(false);
  const error = shallowRef('');
  /** 从真实登录状态推导是否已认证。 */
  const authenticated = computed(() => Boolean(user.value));
  /** 清理只属于当前用户的视图数据，不删除数据库内容。 */
  function clearPrivateState(): void {
    generation += 1;
    profile.value = null;
    conversations.value = [];
    nextCursor.value = null;
    selectedId.value = null;
  }
  /** 自动刷新失败或切换用户时立即清理上一账户的数据。 */
  watch(
    () => user.value?.id,
    (current, previous) => {
      if (current !== previous) clearPrivateState();
    },
    { flush: 'sync' },
  );
  /** 加载资料与会话列表时绑定请求发起时的身份代数。 */
  async function loadWorkspace(): Promise<void> {
    const version = generation;
    const [preferences, list] = await Promise.all([
      authenticatedRequest('/me/profile'),
      authenticatedRequest('/conversations'),
    ]);
    if (version !== generation || !user.value) return;
    profile.value = profileSchema.parse(preferences);
    const parsed = conversationListSchema.parse(list);
    conversations.value = parsed.items;
    nextCursor.value = parsed.nextCursor;
    const remembered = sessionStorage.getItem(`journey:selected:${user.value.id}`);
    const candidate = remembered ?? parsed.items[0]?.id;
    if (candidate) {
      try {
        await selectConversation(candidate);
      } catch {
        if (version === generation) selectedId.value = parsed.items[0]?.id ?? null;
      }
    }
  }
  /** 只保存按账户隔离的会话ID，正文与凭据不写浏览器存储。 */
  watch(
    selectedId,
    (id) => {
      if (user.value && id) sessionStorage.setItem(`journey:selected:${user.value.id}`, id);
    },
    { flush: 'sync' },
  );
  /** 首次打开页面恢复会话；未登录401是正常空态，不显示错误。 */
  async function restore(): Promise<void> {
    try {
      await refreshIdentity();
      await loadWorkspace();
    } catch (cause) {
      if (!(cause instanceof ApiError && cause.status === 401))
        error.value = '账户服务暂时不可用，可以重试';
    } finally {
      ready.value = true;
    }
  }
  /** 登录和注册共享成功收尾，密码仅作为函数参数短暂传递。 */
  async function authenticate(
    mode: 'login' | 'register',
    input: { email: string; password: string; displayName?: string },
  ): Promise<void> {
    busy.value = true;
    error.value = '';
    try {
      const result = await authRequest(mode, input);
      clearPrivateState();
      acceptIdentity(result);
      await loadWorkspace();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '账户操作失败';
      throw cause;
    } finally {
      busy.value = false;
    }
  }
  /** 当前或全部设备退出先完成服务端撤销，再清理内存身份。 */
  async function logout(all = false): Promise<void> {
    busy.value = true;
    error.value = '';
    try {
      await authRequest(all ? 'logout-all' : 'logout');
      clearPrivateState();
      clearIdentity();
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '退出失败，请重试';
      throw cause;
    } finally {
      busy.value = false;
    }
  }
  /** 显示名和旅行偏好使用各自受保护接口，分别持久化。 */
  async function saveProfile(displayName: string, preferences: TravelerProfile): Promise<void> {
    const version = generation;
    busy.value = true;
    error.value = '';
    try {
      const result = userSchema.parse(
        await authenticatedRequest('/me', { method: 'PATCH', body: { displayName } }),
      );
      if (version !== generation) return;
      user.value = result;
      const saved = profileSchema.parse(
        await authenticatedRequest('/me/profile', { method: 'PATCH', body: preferences }),
      );
      if (version === generation) profile.value = saved;
    } catch (cause) {
      if (version === generation) error.value = cause instanceof Error ? cause.message : '保存失败';
      throw cause;
    } finally {
      busy.value = false;
    }
  }
  /** 新建会话真正写入数据库，不再只重置网页中的空对象。 */
  async function createConversation(): Promise<Conversation> {
    const version = generation;
    const item = conversationSchema.parse(
      await authenticatedRequest('/conversations', { method: 'POST', body: { title: '新的旅行' } }),
    );
    if (version !== generation) throw new Error('账户已切换');
    conversations.value = [item, ...conversations.value];
    selectedId.value = item.id;
    return item;
  }
  /** 选择会话时重新访问受保护资源，不能只相信本地列表。 */
  async function selectConversation(id: string): Promise<void> {
    const version = generation;
    const item = conversationSchema.parse(await authenticatedRequest(`/conversations/${id}`));
    if (version !== generation) return;
    selectedId.value = item.id;
  }
  /** 会话改名与归档都通过后端归属校验，归档可恢复。 */
  async function updateConversation(
    id: string,
    changes: { title?: string; archived?: boolean },
  ): Promise<void> {
    const version = generation;
    const item = conversationSchema.parse(
      await authenticatedRequest(`/conversations/${id}`, { method: 'PATCH', body: changes }),
    );
    if (version !== generation) return;
    conversations.value = item.archived
      ? conversations.value.filter((entry) => entry.id !== id)
      : [...conversations.value.filter((entry) => entry.id !== id), item].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );
    if (item.archived && selectedId.value === id) selectedId.value = null;
  }
  /** 分页只追加服务端当前用户的数据，避免重复ID。 */
  async function loadMore(): Promise<void> {
    if (!nextCursor.value) return;
    const version = generation;
    const list = conversationListSchema.parse(
      await authenticatedRequest(`/conversations?cursor=${nextCursor.value}`),
    );
    if (version !== generation) return;
    const ids = new Set(conversations.value.map((item) => item.id));
    conversations.value = [
      ...conversations.value,
      ...list.items.filter((item) => !ids.has(item.id)),
    ];
    nextCursor.value = list.nextCursor;
  }
  /** 对外只提供明确的用户动作和公开状态。 */
  return {
    user,
    profile,
    conversations,
    selectedId,
    nextCursor,
    busy,
    ready,
    error,
    authenticated,
    restore,
    authenticate,
    logout,
    saveProfile,
    createConversation,
    selectConversation,
    updateConversation,
    loadMore,
  };
  /** 结束身份仓库。 */
});
