<script lang="ts">
  import type { StoreResult, TraceabilityReport } from '$lib/models/traceability';
  import { traceabilityStore } from '$lib/stores/traceability-store';

  export let report: TraceabilityReport;
  export let identifierPending: boolean;
  export let actor: string;
  export let onnotice: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void = () => {};

  const statusMeta: Record<TraceabilityReport['status'], { label: string; class: string }> = {
    draft: { label: '未签发', class: 'bg-amber-100 text-amber-950' },
    issued: { label: '已签发', class: 'bg-emerald-100 text-emerald-900' },
    invalidated: { label: '已失效', class: 'bg-red-100 text-red-950' }
  };

  function publish(result: StoreResult) {
    if (result.ok) {
      onnotice({ kind: 'success', text: result.message ?? '操作完成。' });
    } else {
      onnotice({
        kind: 'error',
        text: result.recoveredFrom ? `${result.message}（恢复快照 ${result.recoveredFrom.id}）` : result.message
      });
    }
  }

  function issue() {
    publish(traceabilityStore.issueReport(report.id, actor));
  }

  function acknowledge(itemId: string) {
    publish(traceabilityStore.acknowledgeReconsideration(report.id, itemId, actor));
  }
</script>

<article class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold">{report.id}</h3>
        <span class="badge px-2 py-1 {statusMeta[report.status].class}">{statusMeta[report.status].label}</span>
        {#if identifierPending}
          <span class="badge bg-amber-100 text-amber-950">标识待核</span>
        {/if}
      </div>
      <p class="mt-1 text-sm text-surface-600-300">{report.title}</p>
    </div>
    {#if report.status === 'draft'}
      <button
        class="btn btn-sm variant-filled-primary"
        type="button"
        disabled={identifierPending}
        title={identifierPending ? '标识待核，补齐后才能签发' : '冻结当前依据并签发'}
        on:click={issue}
      >
        签发报告
      </button>
    {/if}
  </div>

  <div class="mt-3 rounded bg-surface-200-800/60 p-3 text-xs text-surface-600-300">
    <p class="font-medium text-surface-700-300">
      追溯依据快照 · 采集于 {report.basis.capturedAt.slice(0, 16).replace('T', ' ')}
    </p>
    <p class="mt-1">
      标识 {report.basis.identifierUdi} V{report.basis.identifierVersion ?? '待核'} ·
      注册证 {report.basis.certNumber} V{report.basis.certVersion}
    </p>
    <div class="mt-2 flex flex-wrap gap-1">
      {#each report.basis.lots as lot (lot.lotId)}
        <span class="badge bg-surface-100-900">{lot.lotNumber} V{lot.version}{lot.status === 'split' ? '（已拆分）' : ''}</span>
      {/each}
    </div>
  </div>

  <div class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-surface-500-400">
    {#if report.signalId}
      <a class="text-primary-700-300 hover:underline" href={`/signals/${report.signalId}`}>关联信号 {report.signalId}</a>
    {:else}
      <span>未关联信号</span>
    {/if}
    <span>信号证据 {report.evidenceIds.length > 0 ? report.evidenceIds.join('、') : '无'}</span>
    {#if report.issuedAt}
      <span>签发于 {report.issuedAt.slice(0, 16).replace('T', ' ')}</span>
    {/if}
  </div>

  {#if report.status === 'invalidated'}
    <div class="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-950">
      <p class="font-medium">未签发报告已失效</p>
      <p class="mt-1">{report.invalidationReason}（{report.invalidatedAt?.slice(0, 16).replace('T', ' ')}）</p>
    </div>
  {/if}

  {#if report.reconsiderations.length > 0}
    <div class="section-rule mt-4 pt-3">
      <p class="text-sm font-medium">复议项（原依据保留，供复核）</p>
      <div class="mt-2 space-y-2">
        {#each report.reconsiderations as item (item.id)}
          <div class="rounded border border-amber-300 bg-amber-50 p-3 text-sm">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <p class="font-medium text-amber-950">{item.reason}</p>
              <div class="flex items-center gap-2">
                <span class="text-xs text-surface-500-400">{item.createdAt.slice(0, 16).replace('T', ' ')}</span>
                {#if item.status === 'open'}
                  <button class="btn btn-xs variant-soft-primary" type="button" on:click={() => acknowledge(item.id)}>确认</button>
                {:else}
                  <span class="badge bg-emerald-100 text-emerald-900">已确认</span>
                {/if}
              </div>
            </div>
            <p class="mt-1 text-xs text-surface-600-300">原依据：{item.before}</p>
            <p class="mt-1 text-xs text-surface-600-300">当前变化：{item.after}</p>
          </div>
        {/each}
      </div>
    </div>
  {/if}
</article>
