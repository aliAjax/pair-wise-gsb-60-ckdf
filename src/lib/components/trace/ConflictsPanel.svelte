<script lang="ts">
  import { shortTime } from '$lib/trace/labels';
  import { traceStore } from '$lib/stores/trace-store';
  import type { EditConflict } from '$lib/trace/types';

  let notice = '';
  function notify(message: string) {
    notice = message;
    setTimeout(() => (notice = ''), 3500);
  }

  // 演示用的并发目标链
  $: bindingOptions = $traceStore.bindings;
  let demoBindingId = bindingOptions[0]?.id ?? '';
  $: if (!demoBindingId && bindingOptions[0]) demoBindingId = bindingOptions[0].id;

  /**
   * 模拟两个窗口同时基于旧版本打开编辑表单：
   * 窗口 A 先保存（成功，链版本 +1）；
   * 窗口 B 仍拿着旧 revision 保存 -> 被乐观锁拦截，输入保留到冲突列表。
   */
  function simulateTwoWindows() {
    const binding = $traceStore.bindings.find((item) => item.id === demoBindingId);
    if (!binding) return notify('请选择追溯链');
    const baseRevision = binding.revision;

    const first = traceStore.dispatch({
      type: 'save_binding',
      bindingId: binding.id,
      expectedRevision: baseRevision,
      actor: '窗口 A · 周宁',
      patch: { batchIds: binding.batchIds }
    });
    if (first.conflict) return notify('窗口 A 意外冲突，请刷新后再试');

    const second = traceStore.dispatch({
      type: 'save_binding',
      bindingId: binding.id,
      expectedRevision: baseRevision,
      actor: '窗口 B · 林澈',
      patch: {
        batchIds: binding.batchIds,
        pendingReason: '窗口 B 同时录入的备注（未覆盖 A 的版本）'
      }
    });
    if (second.conflict) {
      notify(`已生成冲突：A 先到生效（R${baseRevision}→R${baseRevision + 1}），B 的输入已保留`);
    } else {
      notify('未产生冲突（版本基准已变化，请重新打开页面）');
    }
  }

  function resolve(conflict: EditConflict, resolution: 'kept_first' | 'retried_with_latest' | 'discarded') {
    traceStore.dispatch({
      type: 'resolve_conflict',
      conflictId: conflict.id,
      resolution,
      actor: '安全评审专员'
    });
    notify('冲突已处理，后到输入仍留档');
  }
</script>

<div class="space-y-4">
  {#if notice}
    <p class="rounded border border-teal-500/50 bg-teal-50/70 p-2 text-xs text-teal-900 dark:bg-teal-950/30 dark:text-teal-200">{notice}</p>
  {/if}

  <section class="rounded border border-surface-300-700 p-4">
    <h3 class="text-sm font-semibold">并发写入规则</h3>
    <p class="mt-1 text-xs text-surface-500-400">
      两个窗口同时编辑同一标识链时，双方都持有打开时的链版本（乐观锁）。先到的保存落定并推进版本，
      后到的保存被拦截，<strong>输入原样保留</strong>并在下方显式列出冲突，不静默覆盖任何人的修改。
    </p>
    <div class="mt-3 flex flex-wrap items-end gap-2">
      <label class="min-w-[280px]">
        <span class="mb-1 block text-xs">模拟目标链</span>
        <select class="select select-sm" bind:value={demoBindingId}>
          {#each bindingOptions as binding (binding.id)}
            <option value={binding.id}>{binding.signalId} · R{binding.revision}</option>
          {/each}
        </select>
      </label>
      <button class="btn btn-sm variant-filled-primary" type="button" onclick={simulateTwoWindows}>
        模拟两个窗口同时保存
      </button>
    </div>
  </section>

  <section class="rounded border border-surface-300-700 p-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold">冲突记录</h3>
      <span class="badge variant-soft-warning">{$traceStore.conflicts.filter((item) => item.status === 'open').length} 未处理</span>
    </div>
    <div class="mt-3 space-y-3">
      {#each $traceStore.conflicts as conflict (conflict.id)}
        {@const binding = $traceStore.bindings.find((item) => item.id === conflict.bindingId)}
        <article class="rounded border-l-4 border-amber-500 bg-surface-200-800/60 p-3">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <p class="text-sm font-medium">
              {conflict.attemptedAction} · {conflict.actor}
            </p>
            <div class="flex items-center gap-2 text-xs">
              {#if conflict.status === 'resolved'}
                <span class="badge variant-soft-success">已处理</span>
              {:else}
                <span class="badge variant-soft-warning">待处理</span>
              {/if}
              <span class="text-surface-500-400">{shortTime(conflict.createdAt)}</span>
            </div>
          </div>
          <p class="mt-2 text-xs text-surface-600-300">
            链 {binding?.signalId ?? conflict.bindingId}：后到窗口基于 <strong>R{conflict.expectedRevision}</strong>，
            先到版本已落定为 <strong>R{conflict.actualRevision}</strong>。
          </p>
          <pre class="mt-2 overflow-x-auto rounded bg-surface-50-950/70 p-2 text-[11px] text-surface-700-300">{JSON.stringify(
  conflict.attemptedInput,
  null,
  2
)}</pre>
          {#if conflict.status === 'open'}
            <div class="mt-2 flex flex-wrap gap-2">
              <button class="btn btn-xs variant-soft-primary" type="button" onclick={() => resolve(conflict, 'kept_first')}>保留先到版本</button>
              <button class="btn btn-xs variant-soft-secondary" type="button" onclick={() => resolve(conflict, 'retried_with_latest')}>基于最新重做</button>
              <button class="btn btn-xs variant-ghost-surface" type="button" onclick={() => resolve(conflict, 'discarded')}>放弃该输入</button>
            </div>
          {:else}
            <p class="mt-2 text-xs text-teal-700 dark:text-teal-300">处理时间 {conflict.resolvedAt ? shortTime(conflict.resolvedAt) : ''}</p>
          {/if}
        </article>
      {:else}
        <p class="text-xs text-surface-500-400">暂无冲突。可使用上方按钮模拟一次双窗口并发。</p>
      {/each}
    </div>
  </section>
</div>
