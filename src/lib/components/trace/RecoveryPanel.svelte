<script lang="ts">
  import { loadSnapshots } from '$lib/trace/persistence';
  import { shortTime } from '$lib/trace/labels';
  import { exportTraceBundle, traceStore } from '$lib/stores/trace-store';
  import type { TraceState } from '$lib/trace/types';

  let notice = '';
  let noticeKind: 'ok' | 'warn' = 'ok';
  let snapshots = loadSnapshots();
  let importText = '';

  function notify(message: string, kind: 'ok' | 'warn' = 'ok') {
    notice = message;
    noticeKind = kind;
    setTimeout(() => (notice = ''), 4200);
  }

  function refreshSnapshots() {
    snapshots = loadSnapshots();
  }

  /** 先做一次无关紧要的提交以推进状态，再人为引爆下一次写入，观察恢复 */
  function simulateFailure() {
    traceStore.armFailure();
    const outcome = traceStore.dispatch({
      type: 'note_recovery',
      actor: '故障演练',
      detail: '计划内写入：用于触发预置的存储通道故障。'
    });
    refreshSnapshots();
    if (outcome.recovered) {
      notify(`写入失败，已自动从最近完整快照恢复：${outcome.recoveryDetail ?? ''}`, 'warn');
    } else {
      notify('本次写入未失败，可重试故障演练', 'warn');
    }
  }

  function doExport() {
    const blob = new Blob([exportTraceBundle()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `trace-bundle-${new Date().toISOString().slice(0, 19)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify('追溯包已导出（含指纹，可在另一环境导入）');
  }

  function doImport() {
    let parsed: { state?: TraceState };
    try {
      parsed = JSON.parse(importText);
    } catch {
      return notify('JSON 解析失败，请检查追溯包内容', 'warn');
    }
    if (!parsed.state) return notify('追溯包中缺少 state 字段', 'warn');
    const before = $traceStore.events.length;
    const outcome = traceStore.importState(parsed.state, '导入窗口');
    refreshSnapshots();
    if (outcome.recovered) return notify(outcome.recoveryDetail ?? '写入失败已恢复', 'warn');
    if ($traceStore.events.length === before) {
      notify('重复导入：载荷指纹一致，未新增数据，也未新增审计');
    } else {
      notify('导入成功，已按业务编码去重合并');
    }
    importText = '';
  }

  function reset() {
    if (!window.confirm('将清空本地追溯台账并恢复种子数据，确认继续？')) return;
    traceStore.resetDemo();
    refreshSnapshots();
    notify('演示数据已重置');
  }
</script>

<div class="space-y-4">
  {#if notice}
    <p
      class="rounded border p-2 text-xs {noticeKind === 'warn'
        ? 'border-amber-500/50 bg-amber-50/70 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200'
        : 'border-teal-500/50 bg-teal-50/70 text-teal-900 dark:bg-teal-950/30 dark:text-teal-200'}"
    >
      {notice}
    </p>
  {/if}

  <section class="grid gap-4 lg:grid-cols-2">
    <div class="rounded border border-surface-300-700 p-4">
      <h3 class="text-sm font-semibold">写入故障与快照恢复</h3>
      <p class="mt-1 text-xs text-surface-500-400">
        每次成功写入前都保证存在一份结构完整、带校验和的追溯快照。写入失败时立即回滚到最近完整快照，
        并追加一条"故障恢复"审计事件；不产生半截数据。
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="btn btn-sm variant-filled-warning" type="button" onclick={simulateFailure}>
          模拟下一次写入失败并自动恢复
        </button>
        <button class="btn btn-sm variant-ghost-surface" type="button" onclick={refreshSnapshots}>刷新快照列表</button>
      </div>
      <ul class="mt-4 space-y-2">
        {#each snapshots as snapshot (snapshot.id)}
          <li class="rounded bg-surface-200-800/60 p-3 text-xs">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <span class="font-mono font-medium">{snapshot.id}</span>
              <span class="text-surface-500-400">{shortTime(snapshot.createdAt)}</span>
            </div>
            <p class="mt-1 text-surface-600-300">事由：{snapshot.reason}</p>
            <p class="mt-1 text-surface-500-400">
              标识 {snapshot.state.udis.length} · 批号 {snapshot.state.batches.length} · 链 {snapshot.state
                .bindings.length} · 报告 {snapshot.state.reports.length}
            </p>
          </li>
        {:else}
          <li class="text-xs text-surface-500-400">尚无快照（首次写入时自动建立基线）。</li>
        {/each}
      </ul>
    </div>

    <div class="rounded border border-surface-300-700 p-4">
      <h3 class="text-sm font-semibold">导入 / 导出 / 重置</h3>
      <p class="mt-1 text-xs text-surface-500-400">
        导出包带载荷指纹。同一份数据重复导入不会新增任何记录，也不会新增审计；导入按标识编码、
        注册证编号+版本、批号做业务去重合并。
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button class="btn btn-sm variant-filled-primary" type="button" onclick={doExport}>导出追溯包</button>
        <button class="btn btn-sm variant-ghost-error" type="button" onclick={reset}>重置演示数据</button>
      </div>
      <label class="mt-4 block">
        <span class="mb-1 block text-xs font-medium">粘贴追溯包 JSON 导入</span>
        <textarea
          class="textarea textarea-sm h-40 font-mono text-xs"
          bind:value={importText}
          placeholder="粘贴导出的追溯包 JSON（含 exportedAt / payloadHash / state 字段）"
        ></textarea>
      </label>
      <button class="btn btn-sm mt-2 variant-filled-secondary" type="button" onclick={doImport}>导入（自动判重）</button>
    </div>
  </section>

  <section class="rounded border border-surface-300-700 p-4">
    <h3 class="text-sm font-semibold">追溯事件流（只追加，最近 40 条）</h3>
    <div class="mt-3 space-y-3">
      {#each $traceStore.events.slice(0, 40) as event (event.id)}
        <div class="timeline-item">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">{event.action} · {event.actor}</p>
            <span class="text-xs text-surface-500-400">{shortTime(event.createdAt)}</span>
          </div>
          <p class="mt-1 text-xs text-surface-600-300">{event.detail}</p>
          {#if event.signalId || event.reportId}
            <p class="mt-1 text-[11px] text-surface-500-400">
              {event.signalId ?? ''} {event.reportId ? `· ${event.reportId}` : ''}
            </p>
          {/if}
        </div>
      {/each}
    </div>
  </section>
</div>
