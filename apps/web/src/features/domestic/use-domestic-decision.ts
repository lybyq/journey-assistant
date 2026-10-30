/** 国内决策数据按账户和会话隔离，迟到响应不得覆盖新会话。 */
import { onScopeDispose, shallowRef, watch, type MaybeRefOrGetter, toValue } from 'vue';
import { z } from 'zod';
import {
  domesticDecisionSchema,
  domesticProviderSchema,
  domesticHandoffSchema,
  type DomesticDecision,
  type DomesticProvider,
} from '@journey/contracts';
import { useIdentityStore } from '@/stores/identity';
import { authenticatedRequest } from '@/services/http-client';
/** 输入接受响应式运行状态，运行结束后恢复服务端持久化方案。 */
export function useDomesticDecision(runStatus: MaybeRefOrGetter<string>) {
  const identity = useIdentityStore();
  const decision = shallowRef<DomesticDecision | null>(null),
    providers = shallowRef<DomesticProvider[]>([]);
  const loading = shallowRef(false),
    busy = shallowRef(false),
    error = shallowRef('');
  const handoff = shallowRef<ReturnType<typeof domesticHandoffSchema.parse> | null>(null);
  let generation = 0,
    controller: AbortController | undefined;
  /** 每次切换先清空私人内容；共享代数同时约束查询与选择写入响应。 */
  async function refresh() {
    const revision = ++generation;
    busy.value = false;
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    if (!identity.user || !identity.selectedId) {
      decision.value = null;
      providers.value = [];
      loading.value = false;
      return;
    }
    loading.value = true;
    error.value = '';
    try {
      const [snapshot, catalog] = await Promise.all([
        authenticatedRequest(`/travel/domestic/conversations/${identity.selectedId}`, { signal }),
        authenticatedRequest('/travel/domestic/providers', { signal }),
      ]);
      if (revision !== generation) return;
      decision.value = domesticDecisionSchema.parse(snapshot);
      providers.value = z.array(domesticProviderSchema).parse(catalog);
    } catch (cause) {
      if (revision === generation && !signal.aborted)
        error.value = cause instanceof Error ? cause.message : '方案加载失败，请重试';
    } finally {
      if (revision === generation) loading.value = false;
    }
  }
  /** CAS写入成功才更新选中标识，失败保留原选择并显示错误。 */
  async function select(versionId: string) {
    const trip = decision.value?.workspace;
    if (!trip || busy.value) return;
    const revision = generation;
    busy.value = true;
    error.value = '';
    try {
      const saved = await authenticatedRequest(
        `/trips/${trip.id}/domestic/options/${versionId}/select`,
        { method: 'POST', body: { revision: trip.revision }, signal: controller?.signal },
      );
      if (revision === generation) decision.value = domesticDecisionSchema.parse(saved);
    } catch (cause) {
      if (revision === generation)
        error.value = cause instanceof Error ? cause.message : '选择失败';
    } finally {
      if (revision === generation) busy.value = false;
    }
  }
  /** 平台链接只采用服务器固定目录，异步弹窗被拦截时保留可点击链接。 */
  async function openProvider(providerId: string) {
    const trip = decision.value?.workspace;
    if (!trip || busy.value) return;
    const revision = generation;
    busy.value = true;
    error.value = '';
    try {
      const saved = domesticHandoffSchema.parse(
        await authenticatedRequest(`/trips/${trip.id}/domestic/handoff`, {
          method: 'POST',
          body: { providerId },
          signal: controller?.signal,
        }),
      );
      if (revision !== generation) return;
      handoff.value = saved;
      window.open(saved.url, '_blank', 'noopener,noreferrer');
    } catch (cause) {
      if (revision === generation)
        error.value = cause instanceof Error ? cause.message : '入口暂不可用';
    } finally {
      if (revision === generation) busy.value = false;
    }
  }
  watch(
    () => [identity.user?.id, identity.selectedId],
    () => {
      decision.value = null;
      providers.value = [];
      handoff.value = null;
      busy.value = false;
      void refresh();
    },
    { immediate: true, flush: 'sync' },
  );
  watch(
    () => toValue(runStatus),
    (status) => {
      if (['completed', 'cancelled', 'failed'].includes(status)) void refresh();
    },
  );
  onScopeDispose(() => {
    generation++;
    controller?.abort();
  });
  return { decision, providers, loading, busy, error, handoff, refresh, select, openProvider };
}
