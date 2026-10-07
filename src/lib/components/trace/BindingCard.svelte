<script lang="ts">
  import {
    changeKindLabels,
    reportStatusMeta,
    shortDate,
    shortTime
  } from '$lib/trace/labels';
  import { traceStore } from '$lib/stores/trace-store';
  import type { AuditReport, TraceBinding } from '$lib/trace/types';

  export let binding: TraceBinding;
  export let udiCode: string;
  export let certNo: string;
  export let batchNos: string[];

  let actor = '安全评审专员';
  let newReportTitle = '';
  let notice = '';

  let evTitle = '';
  let evSource = '';
  let evType = 'complaint';
  let evStrength = 'moderate';
  let evBatchId = '';
  let evNote = '';
  $: if (!evBatchId && binding.batchIds.length) evBatchId = binding.batchIds[0];

  $: reports = $traceStore.reports
    .filter((report) => report.bindingId === binding.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function notify(message: string) {
    notice = message;
    setTimeout(() => (notice = ''), 3500);
  }

  function createDraft() {
    if (newReportTitle.trim().length < 4) return notify('请填写报告标题');
    const outcome = traceStore.dispatch({
      type: 'create_report',
      bindingId: binding.id,
      title: newReportTitle.trim(),
      author: actor
    });
    if (outcome.conflict) return notify('并发冲突已拦截，请刷新后重试');
    newReportTitle = '';
    notify('已建立新草稿，按当前链依据生成');
  }

  function issue(report: AuditReport) {
    const outcome = traceStore.dispatch({ type: 'issue_report', reportId: report.id, actor });
    if (outcome.conflict) return notify('并发冲突已拦截');
    notify('报告已签发，依据已冻结');
  }

  function resolveItem(report: AuditReport, itemId: string) {
    const resolution = window.prompt('记录复议处理结论（原签发依据保持不变）：', '已按新依据复核，原结论维持。');
    if (!resolution) return;
    traceStore.dispatch({
      type: 'resolve_reconsideration',
      reportId: report.id,
      itemId,
      resolution,
      actor
    });
    notify('复议项已标记处理');
  }

  function addEvidence() {
    if (evTitle.trim().length < 2 || evNote.trim().length < 2) {
      return notify('请填写证据名称与核查说明');
    }
    const outcome = traceStore.dispatch({
      type: 'add_evidence',
      bindingId: binding.id,
      expectedRevision: binding.revision,
      actor,
      evidence: {
        signalId: binding.signalId,
        title: evTitle.trim(),
        source: evSource.trim() || '手工录入',
        evidenceType: evType,
        strength: evStrength,
        batchId: evBatchId,
        note: evNote.trim()
      }
    });
    if (outcome.conflict) return notify('并发冲突：另一窗口已先改动，证据输入已保留在冲突面板');
    evTitle = '';
    evSource = '';
    evNote = '';
    notify('证据已接入追溯链并生成指纹');
  }
</script>

<article class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
  <header class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold">{binding.signalId}</h3>
        {#if binding.verificationState === 'pending'}
          <span class="badge variant-soft-warning">待核</span>
        {:else}
          <span class="badge variant-soft-success">依据已核</span>
        {/if}
        <span class="text-xs text-surface-500-400">链版本 R{binding.revision}</span>
      </div>
      <p class="mt-1 text-sm text-surface-600-300">{binding.signalTitle}</p>
    </div>
  </header>

  <dl class="mt-4 grid gap-3 text-sm md:grid-cols-3">
    <div class="rounded bg-surface-200-800/60 p-3">
      <dt class="text-xs text-surface-500-400">器械标识 UDI-DI（R{binding.udiRevision}）</dt>
      <dd class="mt-1 font-mono text-sm font-semibold">{udiCode}</dd>
    </div>
    <div class="rounded bg-surface-200-800/60 p-3">
      <dt class="text-xs text-surface-500-400">注册证（V{binding.certVersion}）</dt>
      <dd class="mt-1 font-medium">{certNo}</dd>
    </div>
    <div class="rounded bg-surface-200-800/60 p-3">
      <dt class="text-xs text-surface-500-400">生产批号（{batchNos.length}）</dt>
      <dd class="mt-1 font-medium">{batchNos.join('、')}</dd>
    </div>
  </dl>

  {#if binding.verificationState === 'pending'}
    <p class="mt-3 rounded border border-amber-400/60 bg-amber-50/60 p-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
      {binding.pendingReason}
    </p>
  {/if}

  {#if notice}
    <p class="mt-3 rounded border border-teal-500/50 bg-teal-50/70 p-2 text-xs text-teal-900 dark:bg-teal-950/30 dark:text-teal-200">{notice}</p>
  {/if}

  <div class="mt-5">
    <h4 class="text-sm font-semibold">审计报告（{reports.length}）</h4>
    <div class="mt-3 space-y-3">
      {#each reports as report (report.id)}
        {@const meta = reportStatusMeta[report.status]}
        <section class="rounded border border-surface-300-700 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-2">
              <span class="badge {meta.badge}">{meta.label}</span>
              <span class="text-sm font-medium">{report.title}</span>
            </div>
            <span class="text-xs text-surface-500-400">{report.author} · {shortTime(report.createdAt)}</span>
          </div>
          <p class="mt-1 text-xs text-surface-500-400">{meta.hint}</p>

          {#if report.invalidReason}
            <p class="mt-2 rounded border border-red-400/50 bg-red-50/70 p-2 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
              失效原因：{report.invalidReason}（{report.invalidatedAt ? shortTime(report.invalidatedAt) : ''}）
            </p>
          {/if}

          {#if report.frozenBasis}
            <div class="mt-3 rounded bg-surface-200-800/60 p-3 text-xs">
              <p class="font-semibold">签发时冻结依据（{shortTime(report.frozenBasis.frozenAt)}）</p>
              <ul class="mt-2 space-y-1 text-surface-600-300">
                <li>标识：<span class="font-mono">{report.frozenBasis.udiCode}</span> · R{report.frozenBasis.udiRevision}</li>
                <li>注册证：{report.frozenBasis.certNo} · V{report.frozenBasis.certVersion}</li>
                <li>
                  批号：
                  {report.frozenBasis.batches
                    .map((batch) => `${batch.batchNo}(R${batch.revision})`)
                    .join('、')}
                </li>
                <li>证据：{report.frozenBasis.evidence.length} 项（按内容指纹固定）</li>
              </ul>
            </div>
          {/if}

          {#if report.reconsideration.length > 0}
            <div class="mt-3">
              <p class="text-xs font-semibold">复议项（{report.reconsideration.filter((item) => !item.resolved).length} 待处理）</p>
              <ul class="mt-2 space-y-2">
                {#each report.reconsideration as item (item.id)}
                  <li class="border-l-2 border-amber-500 pl-3 text-xs">
                    <div class="flex flex-wrap items-center justify-between gap-2">
                      <span class="font-medium">{changeKindLabels[item.kind]}</span>
                      <span class="text-surface-500-400">{shortDate(item.detectedAt)}</span>
                    </div>
                    <p class="mt-1 text-surface-600-300">{item.detail}</p>
                    {#if item.resolved}
                      <p class="mt-1 text-teal-700 dark:text-teal-300">已处理：{item.resolution}</p>
                    {:else if report.status === 'issued'}
                      <button class="btn btn-xs mt-1 variant-ghost-primary" type="button" onclick={() => resolveItem(report, item.id)}>
                        记录复议结论
                      </button>
                    {/if}
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if report.status === 'draft' && binding.verificationState === 'verified'}
            <button class="btn btn-xs mt-3 variant-filled-success" type="button" onclick={() => issue(report)}>
              签发并冻结当前依据
            </button>
          {/if}
          {#if report.status === 'invalidated'}
            <p class="mt-2 text-xs text-surface-500-400">请按新依据新建草稿；失效报告留档不可直接签发。</p>
          {/if}
        </section>
      {/each}
    </div>

    <div class="mt-3 flex flex-wrap items-end gap-2">
      <label class="min-w-[260px] flex-1">
        <span class="mb-1 block text-xs font-medium">新建报告草稿</span>
        <input class="input input-sm" bind:value={newReportTitle} placeholder="例如：补充批次拆分后的核查审计报告" />
      </label>
      <button class="btn btn-sm variant-soft-primary" type="button" onclick={createDraft}>新建草稿</button>
    </div>
  </div>

  <div class="section-rule mt-5 pt-5">
    <h4 class="text-sm font-semibold">链上证据（{binding.evidence.length}）</h4>
    <ul class="mt-3 space-y-2">
      {#each binding.evidence as ev (ev.id)}
        <li class="rounded bg-surface-200-800/60 p-3 text-xs">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="font-medium">{ev.title}</span>
            <span class="font-mono text-surface-500-400">{ev.contentHash}</span>
          </div>
          <p class="mt-1 text-surface-600-300">
            {ev.source} · 批号 {ev.batchNoAtBinding} · {ev.strength} · 接入 {shortTime(ev.boundAt)}
          </p>
        </li>
      {/each}
    </ul>

    <details class="mt-3">
      <summary class="cursor-pointer text-xs font-medium text-primary-700-300">接入一条信号证据</summary>
      <div class="mt-3 grid gap-3 md:grid-cols-2">
        <label>
          <span class="mb-1 block text-xs">证据名称</span>
          <input class="input input-sm" bind:value={evTitle} />
        </label>
        <label>
          <span class="mb-1 block text-xs">来源</span>
          <input class="input input-sm" bind:value={evSource} placeholder="工单/报告编号" />
        </label>
        <label>
          <span class="mb-1 block text-xs">类型</span>
          <select class="select select-sm" bind:value={evType}>
            <option value="complaint">投诉</option>
            <option value="repair">维修</option>
            <option value="adverse_event">不良事件</option>
            <option value="field_report">现场报告</option>
            <option value="test">测试</option>
            <option value="literature">文献</option>
          </select>
        </label>
        <label>
          <span class="mb-1 block text-xs">强度</span>
          <select class="select select-sm" bind:value={evStrength}>
            <option value="strong">强支持</option>
            <option value="moderate">中等支持</option>
            <option value="weak">弱支持</option>
            <option value="contrary">相反证据</option>
          </select>
        </label>
        <label>
          <span class="mb-1 block text-xs">归属批号</span>
          <select class="select select-sm" bind:value={evBatchId}>
            {#each binding.batchIds as batchId}
              <option value={batchId}>{batchNos[binding.batchIds.indexOf(batchId)] ?? batchId}</option>
            {/each}
          </select>
        </label>
        <label class="md:col-span-2">
          <span class="mb-1 block text-xs">核查说明</span>
          <textarea class="textarea textarea-sm" rows="2" bind:value={evNote}></textarea>
        </label>
        <div>
          <button class="btn btn-sm variant-filled-primary" type="button" onclick={addEvidence}>接入证据（基于 R{binding.revision}）</button>
        </div>
      </div>
    </details>
  </div>
</article>
