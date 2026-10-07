<script lang="ts">
  import { shortTime } from '$lib/trace/labels';
  import { traceStore } from '$lib/stores/trace-store';

  $: pending = $traceStore.bindings.filter((binding) => binding.verificationState === 'pending');

  let notice = '';
  function notify(message: string) {
    notice = message;
    setTimeout(() => (notice = ''), 3500);
  }

  // 每个待核链独立的表单值
  const formState = new Map<string, { mode: 'existing' | 'new'; udiId: string; code: string; manufacturer: string; model: string }>();
  function formFor(bindingId: string) {
    if (!formState.has(bindingId)) {
      formState.set(bindingId, {
        mode: 'existing',
        udiId: $traceStore.udis[0]?.id ?? '',
        code: '',
        manufacturer: '',
        model: ''
      });
    }
    return formState.get(bindingId)!;
  }

  function complete(bindingId: string, expectedRevision: number) {
    const form = formFor(bindingId);
    if (form.mode === 'existing') {
      const udi = $traceStore.udis.find((item) => item.id === form.udiId);
      if (!udi) return notify('请选择已登记标识');
      const outcome = traceStore.dispatch({
        type: 'resolve_pending',
        bindingId,
        expectedRevision,
        actor: '待核补齐窗口',
        udiId: udi.id,
        udiRevision: udi.revision
      });
      if (outcome.conflict) return notify('链已被其他窗口改动，输入已保留到冲突面板');
      notify('标识版本已补齐，报告由待核转为草稿，依据已重算');
    } else {
      if (form.code.trim().length < 6) return notify('请填写完整 UDI-DI');
      if (!form.manufacturer.trim()) return notify('请填写生产商');
      const reg = traceStore.dispatch({
        type: 'register_udi',
        udiCode: form.code.trim(),
        productName: '历史产品（待核补录）',
        manufacturer: form.manufacturer.trim(),
        model: form.model.trim() || '未知型号',
        actor: '待核补齐窗口'
      });
      if (reg.recovered) return notify(reg.recoveryDetail ?? '写入失败已恢复');
      const udi = reg.state.udis.find((item) => item.udiCode === form.code.trim());
      if (!udi) return notify('标识登记失败');
      const outcome = traceStore.dispatch({
        type: 'resolve_pending',
        bindingId,
        expectedRevision,
        actor: '待核补齐窗口',
        udiId: udi.id,
        udiRevision: udi.revision
      });
      if (outcome.conflict) return notify('链已被其他窗口改动，输入已保留到冲突面板');
      notify('新标识已登记并补齐，待核报告已重算');
    }
  }
</script>

<div class="space-y-4">
  {#if notice}
    <p class="rounded border border-teal-500/50 bg-teal-50/70 p-2 text-xs text-teal-900 dark:bg-teal-950/30 dark:text-teal-200">{notice}</p>
  {/if}

  <section class="rounded border border-surface-300-700 p-4">
    <div class="flex items-center justify-between">
      <h3 class="text-sm font-semibold">待核追溯链（旧数据缺标识版本）</h3>
      <span class="badge variant-soft-warning">{pending.length}</span>
    </div>
    <p class="mt-1 text-xs text-surface-500-400">
      旧系统迁移记录仅有产品名称和批号。补齐 UDI-DI 与标识版本后，批号与证据依据自动重算，
      关联报告由"待核"转为草稿；补齐前禁止签发。
    </p>

    <div class="mt-4 space-y-4">
      {#each pending as binding (binding.id)}
        {@const form = formFor(binding.id)}
        {@const batches = binding.batchIds
          .map((id) => $traceStore.batches.find((batch) => batch.id === id)?.batchNo)
          .filter(Boolean)}
        <article class="rounded border border-amber-400/60 bg-amber-50/40 p-4 dark:bg-amber-950/20">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p class="text-sm font-semibold">{binding.signalId} · {binding.signalTitle}</p>
              <p class="mt-1 text-xs text-surface-600-300">批号：{batches.join('、') || '（无）'}</p>
              <p class="mt-1 text-xs text-amber-800 dark:text-amber-200">{binding.pendingReason}</p>
            </div>
            <span class="text-xs text-surface-500-400">链 R{binding.revision} · {shortTime(binding.updatedAt)}</span>
          </div>

          <div class="mt-3 flex flex-wrap gap-4 text-xs">
            <label class="flex items-center gap-1">
              <input type="radio" bind:group={form.mode} value="existing" /> 选择已登记标识
            </label>
            <label class="flex items-center gap-1">
              <input type="radio" bind:group={form.mode} value="new" /> 向生产商核实后补录新标识
            </label>
          </div>

          {#if form.mode === 'existing'}
            <div class="mt-3 flex flex-wrap items-end gap-2">
              <label class="min-w-[280px] flex-1">
                <span class="mb-1 block text-xs">UDI-DI</span>
                <select class="select select-sm" bind:value={form.udiId}>
                  {#each $traceStore.udis as udi (udi.id)}
                    <option value={udi.id}>{udi.udiCode} · {udi.productName}（R{udi.revision}）</option>
                  {/each}
                </select>
              </label>
              <button class="btn btn-sm variant-filled-success" type="button" onclick={() => complete(binding.id, binding.revision)}>
                补齐并重算
              </button>
            </div>
          {:else}
            <div class="mt-3 grid gap-2 md:grid-cols-4">
              <label class="md:col-span-2">
                <span class="mb-1 block text-xs">UDI-DI 编码</span>
                <input class="input input-sm" bind:value={form.code} placeholder="14 位以上编码" />
              </label>
              <label>
                <span class="mb-1 block text-xs">生产商</span>
                <input class="input input-sm" bind:value={form.manufacturer} />
              </label>
              <label>
                <span class="mb-1 block text-xs">型号</span>
                <input class="input input-sm" bind:value={form.model} />
              </label>
              <div class="md:col-span-4">
                <button class="btn btn-sm variant-filled-success" type="button" onclick={() => complete(binding.id, binding.revision)}>
                  登记标识、补齐并重算
                </button>
              </div>
            </div>
          {/if}
        </article>
      {:else}
        <p class="mt-3 text-xs text-surface-500-400">所有迁移数据均已补齐标识版本。</p>
      {/each}
    </div>
  </section>
</div>
