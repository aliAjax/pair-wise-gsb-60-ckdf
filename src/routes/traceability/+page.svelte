<script lang="ts">
  import { enhance } from '$app/forms';
  import IdentifierCard from '$lib/components/traceability/IdentifierCard.svelte';
  import ReportCard from '$lib/components/traceability/ReportCard.svelte';
  import type { SnapshotMeta } from '$lib/models/traceability';
  import { signalStore } from '$lib/stores/signal-store';
  import { traceabilityStore } from '$lib/stores/traceability-store';

  type Tab = 'identifiers' | 'reports' | 'io' | 'audit';

  let tab: Tab = 'identifiers';
  let actor = '安全评审专员';
  let notice: { kind: 'success' | 'error' | 'info'; text: string } | null = null;

  let reportDraft = { title: '', identifierId: '', signalId: '' };
  let importPayload = '';
  let importSummary: string | null = null;
  let snapshots: SnapshotMeta[] = [];

  $: state = $traceabilityStore;
  $: signals = $signalStore;
  $: if (state) snapshots = traceabilityStore.listSnapshots();
  $: integrityProblems = state ? traceabilityStore.validateCurrent() : [];

  $: certById = new Map(state.certificates.map((cert) => [cert.id, cert]));
  $: lotsByIdentifier = new Map(
    state.identifiers.map((identifier) => [
      identifier.id,
      identifier.lotIds
        .map((lotId) => state.lots.find((lot) => lot.id === lotId))
        .filter((lot): lot is NonNullable<typeof lot> => Boolean(lot))
    ])
  );
  $: reportCountByIdentifier = state.reports.reduce<Map<string, number>>((map, report) => {
    map.set(report.identifierId, (map.get(report.identifierId) ?? 0) + 1);
    return map;
  }, new Map());
  $: pendingIdentifiers = state.identifiers.filter((item) => item.status === 'pending_review');
  $: draftReports = state.reports.filter((item) => item.status === 'draft');
  $: invalidatedReports = state.reports.filter((item) => item.status === 'invalidated');
  $: openReconsiderations = state.reports.flatMap((report) =>
    report.reconsiderations.filter((item) => item.status === 'open')
  );
  $: identifierById = new Map(state.identifiers.map((item) => [item.id, item]));
  $: selectedSignal = signals.find((signal) => signal.id === reportDraft.signalId);
  $: selectedEvidenceIds = selectedSignal ? selectedSignal.evidence.map((item) => item.id) : [];

  $: metrics = [
    { label: '器械标识', value: state.identifiers.length, note: `待核 ${pendingIdentifiers.length} 条` },
    { label: '生产批号', value: state.lots.length, note: `已拆分 ${state.lots.filter((lot) => lot.status === 'split').length} 个` },
    { label: '未签发报告', value: draftReports.length, note: `已失效 ${invalidatedReports.length} 份` },
    { label: '待确认复议项', value: openReconsiderations.length, note: '已签发报告上的变更提示' }
  ];

  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'identifiers', label: '标识与批号' },
    { key: 'reports', label: '追溯报告' },
    { key: 'io', label: '导入与快照' },
    { key: 'audit', label: '审计时间线' }
  ];

  const sampleImport = JSON.stringify(
    [
      { importKey: 'IMP-IP8-2026-0001', udi: '06941234560011', lotNumber: 'IP8-260407', manufacturedAt: '2026-04-07', quantity: 900 },
      { importKey: 'IMP-IP8-2026-0002', udi: '06941234560011', lotNumber: 'IP8-260410', manufacturedAt: '2026-04-10', quantity: 1200 },
      { importKey: 'IMP-M12-2026-0003', udi: '06941234560028', lotNumber: 'M12-260205', manufacturedAt: '2026-02-05', quantity: 640 }
    ],
    null,
    2
  );

  function showNotice(next: { kind: 'success' | 'error' | 'info'; text: string }) {
    notice = next;
  }

  function armFailure() {
    traceabilityStore.armWriteFailure();
    showNotice({ kind: 'info', text: '已设定：下一次写入将模拟存储失败，用于验证快照恢复。' });
  }

  function restore(snapshotId: string) {
    const result = traceabilityStore.restoreSnapshot(snapshotId, actor);
    showNotice({ kind: result.ok ? 'success' : 'error', text: result.message ?? (result.ok ? '已恢复。' : '恢复失败。') });
  }

  function resetAll() {
    traceabilityStore.reset();
    importSummary = null;
    showNotice({ kind: 'info', text: '已重置为种子数据。' });
  }
</script>

<svelte:head><title>标识追溯 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-5 flex flex-wrap items-end justify-between gap-3">
  <div>
    <h1 class="text-2xl font-semibold">器械标识追溯</h1>
    <p class="mt-1 text-sm text-surface-600-300">
      器械唯一标识、注册证、生产批号与信号证据连成可复核的追溯记录；标识或注册证变更后，未签发报告立即失效，已签发报告保留原依据并列出复议项。
    </p>
  </div>
  <label class="min-w-[200px]">
    <span class="mb-1 block text-sm font-medium">当前操作人</span>
    <input class="input" bind:value={actor} />
  </label>
</div>

{#if notice}
  <div
    class="mb-4 flex items-start justify-between gap-3 rounded border p-3 text-sm
      {notice.kind === 'success' ? 'border-emerald-300 bg-emerald-50 text-emerald-950' : ''}
      {notice.kind === 'error' ? 'border-red-300 bg-red-50 text-red-950' : ''}
      {notice.kind === 'info' ? 'border-sky-300 bg-sky-50 text-sky-950' : ''}"
    role="status"
  >
    <p>{notice.text}</p>
    <button class="text-xs underline" type="button" on:click={() => (notice = null)}>关闭</button>
  </div>
{/if}

<section class="workspace-grid mb-5">
  {#each metrics as metric}
    <article class="col-span-6 rounded border border-surface-300-700 bg-surface-100-900 p-4 xl:col-span-3">
      <p class="text-sm text-surface-500-400">{metric.label}</p>
      <p class="metric-value mt-2 text-3xl font-semibold">{metric.value}</p>
      <p class="mt-2 text-xs text-surface-500-400">{metric.note}</p>
    </article>
  {/each}
</section>

<div class="mb-5 flex flex-wrap gap-1 border-b border-surface-300-700">
  {#each tabs as item}
    <button
      class="btn btn-sm rounded-b-none {tab === item.key ? 'variant-filled-primary' : 'variant-ghost-surface'}"
      type="button"
      on:click={() => (tab = item.key)}
    >
      {item.label}
    </button>
  {/each}
</div>

{#if tab === 'identifiers'}
  <section class="space-y-4">
    {#if pendingIdentifiers.length > 0}
      <p class="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
        {pendingIdentifiers.length} 条旧数据缺少标识版本，处于待核状态；补齐版本后将自动重算关联报告。
      </p>
    {/if}
    {#each state.identifiers as identifier (identifier.id)}
      <IdentifierCard
        {identifier}
        cert={certById.get(identifier.certId)}
        lots={lotsByIdentifier.get(identifier.id) ?? []}
        reportCount={reportCountByIdentifier.get(identifier.id) ?? 0}
        {actor}
        onnotice={showNotice}
      />
    {/each}
  </section>
{:else if tab === 'reports'}
  <section class="mb-6 rounded border border-surface-300-700 bg-surface-100-900 p-4">
    <h2 class="font-semibold">建立追溯报告</h2>
    <p class="mt-1 text-xs text-surface-500-400">以当前标识、注册证与批号版本生成依据快照；签发前为未签发状态，上游变更将使其失效。</p>
    <form
      class="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
      method="POST"
      action="?/createReport"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'failure') {
            showNotice({ kind: 'error', text: String((result.data as { message?: string } | undefined)?.message ?? '校验失败') });
            return;
          }
          if (result.type === 'success') {
            const payload = (result.data as { createdReport?: Parameters<typeof traceabilityStore.createReport>[0] }).createdReport;
            if (!payload) return;
            const storeResult = traceabilityStore.createReport(payload);
            showNotice({ kind: storeResult.ok ? 'success' : 'error', text: storeResult.message ?? '' });
            if (storeResult.ok) reportDraft = { title: '', identifierId: '', signalId: '' };
          }
        };
      }}
    >
      <input type="hidden" name="actor" value={actor} />
      <input type="hidden" name="evidenceIds" value={selectedEvidenceIds.join(',')} />
      <label>
        <span class="mb-1 block text-sm font-medium">报告标题</span>
        <input class="input" name="title" bind:value={reportDraft.title} required minlength="6" placeholder="如：SIG-2026-0xx 追溯报告" />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">器械标识</span>
        <select class="select" name="identifierId" bind:value={reportDraft.identifierId} required>
          <option value="" disabled>选择标识</option>
          {#each state.identifiers as identifier (identifier.id)}
            <option value={identifier.id}>
              {identifier.productName}（{identifier.udi}{identifier.status === 'pending_review' ? '，待核' : `，V${identifier.version}`}）
            </option>
          {/each}
        </select>
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">关联信号（可选）</span>
        <select class="select" name="signalId" bind:value={reportDraft.signalId}>
          <option value="">不关联</option>
          {#each signals as signal (signal.id)}
            <option value={signal.id}>{signal.id} · {signal.title}</option>
          {/each}
        </select>
      </label>
      <div class="flex items-end">
        <button class="btn w-full variant-filled-primary" type="submit">
          建立报告{selectedEvidenceIds.length > 0 ? `（带入 ${selectedEvidenceIds.length} 项证据）` : ''}
        </button>
      </div>
    </form>
  </section>

  <section class="space-y-4">
    {#each state.reports as report (report.id)}
      <ReportCard
        {report}
        identifierPending={identifierById.get(report.identifierId)?.status === 'pending_review'}
        {actor}
        onnotice={showNotice}
      />
    {/each}
  </section>
{:else if tab === 'io'}
  <div class="grid gap-6 xl:grid-cols-2">
    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <h2 class="font-semibold">批号记录导入</h2>
      <p class="mt-1 text-xs text-surface-500-400">按 importKey 幂等去重：重复导入不会新增批号，也不会新增审计记录。</p>
      <form
        class="mt-4 space-y-3"
        method="POST"
        action="?/importBatch"
        use:enhance={() => {
          return async ({ result }) => {
            if (result.type === 'failure') {
              showNotice({ kind: 'error', text: String((result.data as { message?: string } | undefined)?.message ?? '校验失败') });
              return;
            }
            if (result.type === 'success') {
              const payload = (result.data as { imported?: { records: import('$lib/models/traceability').ImportRecord[]; actor: string } }).imported;
              if (!payload) return;
              const storeResult = traceabilityStore.importRecords(payload.records, payload.actor);
              importSummary = storeResult.message ?? null;
              showNotice({ kind: storeResult.ok ? 'success' : 'error', text: storeResult.message ?? '' });
            }
          };
        }}
      >
        <input type="hidden" name="actor" value={actor} />
        <textarea class="textarea font-mono text-xs" name="payload" rows="10" bind:value={importPayload} placeholder="粘贴 JSON 数组，每条记录含 importKey / udi / lotNumber / manufacturedAt / quantity"></textarea>
        <div class="flex flex-wrap gap-2">
          <button class="btn variant-filled-primary" type="submit">执行导入</button>
          <button class="btn variant-soft-secondary" type="button" on:click={() => (importPayload = sampleImport)}>填入示例（含 1 条重复）</button>
        </div>
      </form>
      {#if importSummary}
        <p class="mt-3 rounded bg-surface-200-800/60 p-3 text-sm">{importSummary}</p>
      {/if}
      <p class="mt-3 text-xs text-surface-500-400">已记录导入键 {state.importedKeys.length} 个：{state.importedKeys.join('、') || '无'}</p>
    </section>

    <section class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
      <div class="flex items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold">追溯快照与恢复</h2>
          <p class="mt-1 text-xs text-surface-500-400">每次成功写入后保留完整快照（最近 {snapshots.length} 份）；写入失败时自动从最近完整快照恢复。</p>
        </div>
        <span class="badge {integrityProblems.length === 0 ? 'bg-emerald-100 text-emerald-900' : 'bg-red-100 text-red-950'}">
          {integrityProblems.length === 0 ? '当前状态完整' : '状态异常'}
        </span>
      </div>
      {#if integrityProblems.length > 0}
        <ul class="mt-3 list-disc space-y-1 pl-5 text-sm text-red-900">
          {#each integrityProblems as problem}
            <li>{problem}</li>
          {/each}
        </ul>
      {/if}
      <div class="mt-4 space-y-2">
        {#each snapshots as snapshot (snapshot.id)}
          <div class="flex flex-wrap items-center justify-between gap-2 rounded border border-surface-300-700 p-3 text-sm">
            <div>
              <p class="font-medium">{snapshot.id}</p>
              <p class="text-xs text-surface-500-400">{snapshot.createdAt.slice(0, 19).replace('T', ' ')}</p>
            </div>
            <button class="btn btn-sm variant-soft-primary" type="button" on:click={() => restore(snapshot.id)}>恢复此快照</button>
          </div>
        {:else}
          <p class="text-sm text-surface-500-400">暂无快照，完成一次写入后自动生成。</p>
        {/each}
      </div>
      <div class="section-rule mt-4 flex flex-wrap gap-2 pt-4">
        <button class="btn btn-sm variant-soft-error" type="button" on:click={armFailure}>模拟下次写入失败</button>
        <button class="btn btn-sm variant-ghost-surface" type="button" on:click={resetAll}>重置为种子数据</button>
      </div>
    </section>
  </div>
{:else}
  <section class="rounded border border-surface-300-700 bg-surface-100-900">
    <div class="border-b border-surface-300-700 px-4 py-3">
      <h2 class="font-semibold">追溯审计时间线</h2>
      <p class="mt-1 text-xs text-surface-500-400">标识更正、批号拆分、注册证换版、签发、失效、复议与快照恢复，共 {state.audit.length} 条。</p>
    </div>
    <div class="space-y-5 p-5">
      {#each state.audit as entry (entry.id)}
        <article class="timeline-item">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">{entry.action} · {entry.actor}</p>
            <span class="text-xs text-surface-500-400">{entry.createdAt.slice(0, 19).replace('T', ' ')}</span>
          </div>
          <p class="mt-1 text-sm text-surface-600-300">{entry.detail}</p>
        </article>
      {:else}
        <p class="text-sm text-surface-500-400">暂无审计记录。</p>
      {/each}
    </div>
  </section>
{/if}
