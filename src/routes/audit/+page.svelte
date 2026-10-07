<script lang="ts">
  import { reportStatusMeta, shortTime } from '$lib/trace/labels';
  import { signalStore } from '$lib/stores/signal-store';
  import { traceStore } from '$lib/stores/trace-store';

  $: signals = $signalStore;
  $: auditEntries = signals
    .flatMap((signal) => signal.audit.map((entry) => ({ ...entry, signalId: signal.id, product: signal.product })))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  $: trace = $traceStore;
  $: traceReports = trace.reports
    .map((report) => {
      const binding = trace.bindings.find((item) => item.id === report.bindingId);
      return { report, binding };
    })
    .sort((a, b) => b.report.updatedAt.localeCompare(a.report.updatedAt));

  function exportAll() {
    const payload = {
      generatedAt: new Date().toISOString(),
      traceReports: traceReports.map(({ report, binding }) => ({
        id: report.id,
        signalId: report.signalId,
        title: report.title,
        status: report.status,
        issuedAt: report.issuedAt,
        frozenBasis: report.frozenBasis ?? null,
        invalidReason: report.invalidReason ?? null,
        reconsideration: report.reconsideration,
        binding: binding
          ? {
              id: binding.id,
              revision: binding.revision,
              udiRevision: binding.udiRevision,
              certVersion: binding.certVersion,
              verificationState: binding.verificationState
            }
          : null
      })),
      signals: signals.map((signal) => ({
        id: signal.id,
        product: signal.product,
        batch: signal.batch,
        status: signal.status,
        risk: signal.riskLevel,
        conclusion: signal.versions[0] ?? null,
        audit: signal.audit
      }))
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'medical-device-safety-audit-report.json';
    anchor.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>审计报告 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">审计与可追溯报告</h1>
    <p class="mt-1 text-sm text-surface-600-300">
      签发即冻结标识、注册证、批号与证据指纹；依据变更后旧报告仍能说清当时引用的是哪一版。
    </p>
  </div>
  <div class="flex gap-2">
    <a class="btn variant-soft-primary" href="/trace">进入标识追溯台账</a>
    <button class="btn variant-filled-primary" type="button" onclick={exportAll}>导出完整审计包</button>
  </div>
</div>

<section class="mb-6 rounded border border-surface-300-700 bg-surface-100-900">
  <div class="border-b border-surface-300-700 px-4 py-3">
    <h2 class="font-semibold">追溯审计报告</h2>
    <p class="mt-1 text-xs text-surface-500-400">
      已签发报告保留冻结依据并列复议项；未签发报告在批号/注册证/标识变更时立即失效。
    </p>
  </div>
  <div class="divide-y divide-surface-300-700">
    {#each traceReports as { report, binding }}
      {@const meta = reportStatusMeta[report.status]}
      <article class="px-4 py-4">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div class="flex flex-wrap items-center gap-2">
              <span class="badge {meta.badge}">{meta.label}</span>
              <h3 class="font-medium">{report.title}</h3>
            </div>
            <p class="mt-1 text-xs text-surface-500-400">
              {report.id} · {report.signalId} · {report.author} · 更新 {shortTime(report.updatedAt)}
            </p>
          </div>
          {#if binding}
            <span class="text-xs text-surface-500-400">
              链 R{binding.revision} · UDI R{binding.udiRevision} · 证 V{binding.certVersion}
            </span>
          {/if}
        </div>

        {#if report.frozenBasis}
          <div class="mt-3 grid gap-2 rounded bg-surface-200-800/60 p-3 text-xs md:grid-cols-2">
            <p>
              <span class="text-surface-500-400">冻结标识：</span>
              <span class="font-mono">{report.frozenBasis.udiCode}</span>（R{report.frozenBasis.udiRevision}）
            </p>
            <p>
              <span class="text-surface-500-400">冻结注册证：</span>
              {report.frozenBasis.certNo}（V{report.frozenBasis.certVersion}）
            </p>
            <p class="md:col-span-2">
              <span class="text-surface-500-400">冻结批号：</span>
              {report.frozenBasis.batches.map((batch) => `${batch.batchNo}(R${batch.revision})`).join('、')}
              · {report.frozenBasis.evidence.length} 项证据指纹 · {shortTime(report.frozenBasis.frozenAt)}
            </p>
          </div>
        {/if}

        {#if report.invalidReason}
          <p class="mt-3 rounded border border-red-400/50 bg-red-50/70 p-2 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
            已失效：{report.invalidReason}
          </p>
        {/if}

        {#if report.reconsideration.length > 0}
          <ul class="mt-3 space-y-2">
            {#each report.reconsideration as item (item.id)}
              <li class="border-l-2 border-amber-500 pl-3 text-xs">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <span class="font-medium">复议项 · {item.kind === 'cert_revised' ? '注册证换版' : item.kind === 'batch_split' ? '批号拆分' : item.kind === 'batch_corrected' ? '批号更正' : '标识更正'}</span>
                  <span>{#if item.resolved}<span class="text-teal-700 dark:text-teal-300">已处理</span>{:else}<span class="text-amber-700 dark:text-amber-300">待处理</span>{/if}</span>
                </div>
                <p class="mt-1 text-surface-600-300">{item.detail}</p>
                {#if item.resolution}<p class="mt-1 text-surface-500-400">处理结论：{item.resolution}</p>{/if}
              </li>
            {/each}
          </ul>
        {/if}
      </article>
    {/each}
  </div>
</section>

<section class="rounded border border-surface-300-700 bg-surface-100-900">
  <div class="border-b border-surface-300-700 px-4 py-3">
    <h2 class="font-semibold">信号审计时间线</h2>
    <p class="mt-1 text-xs text-surface-500-400">共 {auditEntries.length} 条持久化记录</p>
  </div>
  <div class="space-y-5 p-5">
    {#each auditEntries as entry}
      <article class="timeline-item">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-sm font-medium">{entry.action} · {entry.actor}</p>
          <span class="text-xs text-surface-500-400">{entry.createdAt.slice(0, 16).replace('T', ' ')}</span>
        </div>
        <p class="mt-1 text-sm text-surface-600-300">{entry.detail}</p>
        <p class="mt-1 text-xs text-surface-500-400">{entry.signalId} · {entry.product}</p>
      </article>
    {/each}
  </div>
</section>
