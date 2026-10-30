/** 模型只接收当前方案选中的事实摘要，不能在全量车次中误配席别。 */
import type { DomesticDecision } from '@journey/contracts';
/** 已冻结版本是日程和价格的唯一事实来源，查询候选只补充所选交通的描述。 */
export function domesticDecisionSummary(decision: DomesticDecision) {
  return {
    tripId: decision.workspace?.id,
    stale: decision.stale,
    options: decision.optionSet?.options.map((option, index) => {
      const version = option.version;
      const ids = new Set(
        version.draft.days.flatMap((day) =>
          day.items.flatMap((item) => (item.referenceId ? [item.referenceId] : [])),
        ),
      );
      return {
        ordinal: index + 1,
        label: option.label,
        versionId: version.id,
        status: version.status,
        budget: {
          currency: version.budget.currency,
          knownSubtotalMinor: version.budget.knownTotalMinor,
          reserveMinor: version.budget.reserveMinor,
          knownWithReserveMinor: version.budget.totalWithReserveMinor,
          complete: version.budget.complete,
          rankingEligible: version.budget.rankingEligible,
        },
        transport: decision.workspace?.document.transport
          .filter((item) => ids.has(item.id))
          .slice(0, 2)
          .map((item) => {
            const price = version.prices.find((price) => price.id === item.quote?.id);
            return {
              label: item.label,
              origin: item.origin,
              destination: item.destination,
              departure: item.departure,
              arrival: item.arrival,
              seat: item.seatType,
              availability: item.availability,
              unitAmountMinor: price?.unitAmountMinor ?? null,
              quantity: price?.quantity ?? null,
              currency: price?.currency ?? null,
              checkedAt: price?.checkedAt ?? item.checkedAt,
            };
          }),
        dayCount: version.draft.days.length,
        daysPreview: version.draft.days.slice(0, 3).map((day) => ({
          date: day.date,
          activities: day.items.slice(0, 4).map((item) => item.title.slice(0, 60)),
        })),
        issues: [...new Set(version.violations.map((issue) => issue.message))].slice(0, 4),
      };
    }),
    limitations: decision.optionSet?.limitations.slice(0, 8).map((line) => line.slice(0, 250)),
    next: '完整日程已在方案画布，编号按ordinal；金额采用服务端budget，未覆盖的费用另列。',
  };
}
