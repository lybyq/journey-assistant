/** 旅行工作区网络编排集中在composable，组件只发出用户意图。 */
import { computed, onUnmounted, shallowRef, watch } from 'vue';
/** 单一账户来源保证退出后清空私人旅行资料。 */
import { useIdentityStore } from '@/stores/identity';
/** 凭据只存在网络服务内部，不向组件暴露Token。 */
import { authenticatedRequest, authenticatedStream } from '@/services/http-client';
/** 每个响应在进入UI前校验，不直接相信模型或服务JSON形状。 */
import {
  tripWorkspaceSchema,
  planVersionSchema,
  costBreakdownSchema,
  type TripWorkspace,
  type PlanVersion,
  type CostItem,
  type CostBreakdown,
  type TripRequestPatch,
} from '@journey/contracts';
/** 安全的可见列表仅含标题和状态，不保存聊天内容。 */
export interface TripListItem {
  id: string;
  title: string;
  revision: number;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}
/** 供应商摘要不含密钥或内部地址。 */
export interface TravelCapability {
  modules: number[];
  suppliers: {
    id: string;
    modules: number[];
    configured: boolean;
    environment: string;
  }[];
}
/** 一份数据来源供九个面板共用，不能每个面板各创建私有副本。 */
export function useTravelWorkspace() {
  /** 状态使用浅引用整份替换，避免代理大段不可变证据与版本。 */
  const identity = useIdentityStore();
  const projects = shallowRef<TripListItem[]>([]);
  const workspace = shallowRef<TripWorkspace | null>(null);
  const version = shallowRef<PlanVersion | null>(null);
  const budget = shallowRef<CostBreakdown | null>(null);
  /** 接口反馈独立于聊天加载状态。 */
  const busy = shallowRef(false);
  const loading = shallowRef(false);
  const error = shallowRef('');
  const notice = shallowRef('');
  const comparison = shallowRef<any>(null);
  const shares = shallowRef<any[]>([]);
  const newShare = shallowRef('');
  const metrics = shallowRef<any>(null);
  const capabilities = shallowRef<TravelCapability | null>(null);
  /** 代数使退出、切换账户或项目后的迟到响应失效。 */
  let generation = 0;
  let controller: AbortController | undefined;
  /** 当前修订号只来自真实保存结果，不能在前端猜测自增。 */
  const revision = computed(() => workspace.value?.revision ?? 0);
  /** 一个项目操作必须由当前用户明确选择。 */
  function required(): TripWorkspace {
    if (!workspace.value) throw new Error('请先创建或选择旅行项目');
    return workspace.value;
  }
  /** 每次切换页面仍可以恢复该账户上次选择的ID，正文与凭据不写浏览器存储。 */
  async function select(id: string) {
    const current = ++generation;
    controller?.abort();
    busy.value = false;
    workspace.value = null;
    version.value = null;
    budget.value = null;
    comparison.value = null;
    shares.value = [];
    newShare.value = '';
    loading.value = true;
    error.value = '';
    try {
      const result = tripWorkspaceSchema.parse(await authenticatedRequest(`/trips/${id}`));
      if (current !== generation) return;
      workspace.value = result;
      if (identity.user) sessionStorage.setItem(`journey:trip:${identity.user.id}`, id);
      if (result.activeVersionId) await loadVersion(result.activeVersionId, current);
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : '项目读取失败';
    } finally {
      if (current === generation) loading.value = false;
    }
  }
  /** 初始列表、能力和当前用户运行统计一起读取，但不调用任何供应商。 */
  async function initialize() {
    const current = ++generation;
    controller?.abort();
    busy.value = false;
    projects.value = [];
    workspace.value = null;
    version.value = null;
    budget.value = null;
    comparison.value = null;
    shares.value = [];
    newShare.value = '';
    metrics.value = null;
    capabilities.value = null;
    error.value = '';
    loading.value = false;
    if (!identity.user) return;
    loading.value = true;
    try {
      const [list, caps, stats] = await Promise.all([
        authenticatedRequest('/trips'),
        authenticatedRequest('/travel/capabilities'),
        authenticatedRequest('/travel/metrics'),
      ]);
      if (current !== generation) return;
      projects.value = list as TripListItem[];
      capabilities.value = caps as TravelCapability;
      metrics.value = stats;
      const remembered = sessionStorage.getItem(`journey:trip:${identity.user.id}`);
      const candidate =
        projects.value.find((item) => item.id === remembered && !item.archived) ??
        projects.value.find((item) => !item.archived);
      if (candidate) await select(candidate.id);
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : '旅行工作区暂时不可用';
    } finally {
      loading.value = false;
    }
  }
  /** 外部查询后读取新的revision和版本列表，失败不伪造保存成功。 */
  async function reload() {
    const trip = workspace.value;
    if (!trip) return;
    const current = generation;
    const saved = tripWorkspaceSchema.parse(await authenticatedRequest(`/trips/${trip.id}`));
    if (current !== generation) return;
    workspace.value = saved;
    projects.value = projects.value.map((item) =>
      item.id === saved.id
        ? {
            ...item,
            title: saved.title,
            revision: saved.revision,
            archived: saved.archived,
          }
        : item,
    );
  }
  /** 写操作有统一取消、反馈和账户代数检查。 */
  async function action(path: string, body: unknown, method: 'POST' | 'PATCH' | 'PUT' = 'POST') {
    if (busy.value) return;
    const trip = required();
    const current = generation;
    busy.value = true;
    error.value = '';
    notice.value = '';
    controller = new AbortController();
    try {
      const result: any = await authenticatedRequest(`/trips/${trip.id}${path}`, {
        method,
        body,
        signal: controller.signal,
        timeoutMs: 95000,
      });
      if (current !== generation) return;
      const parsed = tripWorkspaceSchema.safeParse(result?.workspace ?? result);
      if (parsed.success) workspace.value = parsed.data;
      const plan = planVersionSchema.safeParse(result);
      if (plan.success) version.value = plan.data;
      await reload();
      budget.value = null;
      await calculate();
      const stats = await authenticatedRequest('/travel/metrics').catch(() => null);
      if (current !== generation) return;
      if (stats) metrics.value = stats;
      notice.value = '已完成并保存';
      return result;
    } catch (cause) {
      if (current === generation) {
        error.value = controller.signal.aborted
          ? '操作已取消；已保存结果可刷新查看'
          : cause instanceof Error
            ? cause.message
            : '旅行操作失败';
        await reload().catch(() => undefined);
      }
      return undefined;
    } finally {
      if (current === generation) busy.value = false;
    }
  }
  /** 创建只接受本账户可访问的会话绑定。 */
  async function create(title: string, text: string, bindConversation: boolean) {
    if (busy.value) return;
    const current = generation;
    busy.value = true;
    error.value = '';
    try {
      const saved = tripWorkspaceSchema.parse(
        await authenticatedRequest('/trips', {
          method: 'POST',
          body: {
            title,
            text,
            request: {},
            conversationId: bindConversation ? identity.selectedId : null,
          },
        }),
      );
      if (current !== generation) return;
      projects.value = [
        {
          id: saved.id,
          title: saved.title,
          revision: saved.revision,
          archived: saved.archived,
          createdAt: saved.createdAt,
          updatedAt: saved.updatedAt,
        },
        ...projects.value,
      ];
      await select(saved.id);
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : '项目创建失败';
    } finally {
      if (current === generation) busy.value = false;
    }
  }
  /** 自然语言提取用于草稿预览，最终仍由用户保存确认。 */
  async function parse(text: string) {
    return authenticatedRequest('/trips/parse', {
      method: 'POST',
      body: { text },
    }) as Promise<{
      patch: TripRequestPatch;
      request: TripWorkspace['document']['request'];
      clarifications: TripWorkspace['clarifications'];
    }>;
  }
  /** 保存需求只修改显式提交的字段。 */
  function saveRequest(patch: TripRequestPatch) {
    return action('', { revision: revision.value, request: patch }, 'PATCH');
  }
  /** 归档可以恢复，不删除历史版本与来源。 */
  function archive(archived: boolean) {
    return action('', { revision: revision.value, archived }, 'PATCH');
  }
  /** 业务模块的查询都携带当前真实修订号。 */
  function query(path: string, input?: unknown) {
    return action(path, {
      revision: revision.value,
      ...(input === undefined ? {} : { input }),
    });
  }
  /** 金额预算输出独立校验，未知人数时明确显示错误。 */
  async function calculate() {
    const trip = required();
    const current = generation;
    try {
      const result = costBreakdownSchema.parse(
        await authenticatedRequest(`/trips/${trip.id}/pricing`),
      );
      if (current === generation) budget.value = result;
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : '预算计算失败';
    }
  }
  /** 费用选择仍保留原始供应商字段，不在UI改写provenance。 */
  async function toggleCost(id: string, selected: boolean) {
    const trip = required();
    const costs = trip.document.costs.map((item) =>
      item.id === id ? { ...item, selected } : item,
    );
    const result = await action(
      '/pricing',
      {
        revision: revision.value,
        costs,
        rates: trip.document.rates,
        reserveBps: trip.document.reserveBps,
      },
      'PUT',
    );
    if (result) await calculate();
  }
  /** 可明确改变预备金与汇率，所有数值由后端重算。 */
  async function savePricing(
    costs: CostItem[],
    rates: TripWorkspace['document']['rates'],
    reserveBps: number,
  ) {
    const result = await action(
      '/pricing',
      { revision: revision.value, costs, rates, reserveBps },
      'PUT',
    );
    if (result) await calculate();
  }
  /** 读取旧版本不会改变当前版本指针。 */
  async function loadVersion(id: string, current = generation) {
    const trip = required();
    try {
      const saved = planVersionSchema.parse(
        await authenticatedRequest(`/trips/${trip.id}/plans/${id}`),
      );
      if (current === generation) version.value = saved;
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : '版本读取失败';
    }
  }
  /** 版本比较只在同一项目内执行。 */
  async function compare(ids: string[]) {
    const result = await action('/plans/compare', { versionIds: ids });
    if (result) comparison.value = result;
  }
  /** 旧版本回退只切换指针，报价过期不会重新有效。 */
  async function activate(id: string) {
    const result = await action(`/plans/${id}/activate`, {
      revision: revision.value,
    });
    if (result) await loadVersion(id);
  }
  /** 分享固定到当前正在查看的版本。 */
  async function createShare(hours: number) {
    if (!version.value) return;
    const result = await action('/delivery/shares', {
      versionId: version.value.id,
      expiresInHours: hours,
    });
    if (result) {
      newShare.value = result.url;
      await loadShares();
    }
  }
  /** 分享列表不包含令牌明文。 */
  async function loadShares() {
    const trip = required();
    const current = generation;
    try {
      const result = (await authenticatedRequest(`/trips/${trip.id}/delivery/shares`)) as any[];
      if (current === generation) shares.value = result;
    } catch (cause) {
      if (current === generation)
        error.value = cause instanceof Error ? cause.message : '分享读取失败';
    }
  }
  /** 撤销完成后更新真实状态。 */
  async function revokeShare(id: string) {
    const result = await action(`/delivery/shares/${id}/revoke`, {});
    if (result) {
      newShare.value = '';
      await loadShares();
    }
  }
  /** 真实PDF/Markdown通过受保护下载，不把令牌写入下载链接。 */
  async function download(kind: 'pdf' | 'markdown') {
    const trip = required();
    if (!version.value) return;
    const current = generation;
    const selectedVersion = version.value;
    try {
      const response = await authenticatedStream(
        `/trips/${trip.id}/delivery/${selectedVersion.id}/${kind}`,
        AbortSignal.timeout(30000),
      );
      const blob = await response.blob();
      if (current !== generation) return;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `journey-v${selectedVersion.version}.${kind === 'pdf' ? 'pdf' : 'md'}`;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      error.value = cause instanceof Error ? cause.message : '导出失败';
    }
  }
  /** 当前用户切换时立刻清除旧账户数据。 */
  watch(
    () => identity.user?.id,
    () => {
      void initialize();
    },
    { immediate: true },
  );
  /** 页面销毁只取消本页面业务查询，不取消独立后台聊天运行。 */
  onUnmounted(() => {
    generation += 1;
    controller?.abort();
  });
  /** 组件只能通过明确动作修改服务端数据。 */
  return {
    projects,
    workspace,
    version,
    budget,
    revision,
    busy,
    loading,
    error,
    notice,
    comparison,
    shares,
    newShare,
    metrics,
    capabilities,
    select,
    create,
    parse,
    saveRequest,
    archive,
    query,
    action,
    reload,
    calculate,
    toggleCost,
    savePricing,
    loadVersion,
    compare,
    activate,
    createShare,
    loadShares,
    revokeShare,
    download,
    cancel: () => controller?.abort(),
  };
}
