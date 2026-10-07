<script lang="ts">
  import { shortDate } from '$lib/trace/labels';
  import { traceStore } from '$lib/stores/trace-store';

  let notice = '';
  function notify(message: string) {
    notice = message;
    setTimeout(() => (notice = ''), 3500);
  }

  // ── 标识更正 ──
  let udiId = $traceStore.udis[0]?.id ?? '';
  let newUdiCode = '';
  let udiReason = '';

  function correctUdi() {
    if (!udiId || newUdiCode.trim().length < 6) return notify('请选择标识并填写更正后的编码');
    if (!udiReason.trim()) return notify('请填写更正原因');
    const outcome = traceStore.dispatch({
      type: 'correct_udi',
      udiId,
      newCode: newUdiCode.trim(),
      reason: udiReason.trim(),
      actor: '生产商更正窗口'
    });
    if (outcome.recovered) return notify(outcome.recoveryDetail ?? '已从快照恢复');
    newUdiCode = '';
    udiReason = '';
    notify('标识已更正，关联报告规则已触发');
  }

  // ── 注册证换版 ──
  let certId = $traceStore.certificates[0]?.id ?? '';
  let certVersion = '';
  let certReason = '';

  function reviseCert() {
    const version = Number(certVersion);
    if (!certId || !version) return notify('请选择注册证并填写新版本号');
    if (!certReason.trim()) return notify('请填写换版事由');
    traceStore.dispatch({
      type: 'revise_certificate',
      certId,
      newVersion: version,
      reason: certReason.trim(),
      actor: '注册专员窗口'
    });
    certVersion = '';
    certReason = '';
    notify('注册证已换版');
  }

  // ── 批号更正 ──
  let batchId = $traceStore.batches.find((batch) => batch.status === 'active')?.id ?? '';
  let newBatchNo = '';
  let batchReason = '';

  function correctBatch() {
    if (!batchId || newBatchNo.trim().length < 2) return notify('请选择批号并填写更正值');
    if (!batchReason.trim()) return notify('请填写更正原因');
    traceStore.dispatch({
      type: 'correct_batch',
      batchId,
      newBatchNo: newBatchNo.trim(),
      reason: batchReason.trim(),
      actor: '生产质量窗口'
    });
    newBatchNo = '';
    batchReason = '';
    notify('批号已更正');
  }

  // ── 批号拆分 ──
  let splitTarget = '';
  let splitText = '';
  function splitBatch() {
    if (!splitTarget || !splitText.trim()) return notify('请选择被拆分批号并填写拆分批号（每行一个）');
    const lines = splitText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return notify('至少填写一个拆分批号');
    const parts = lines.map((line) => {
      const [batchNo, quantityRaw, ...rest] = line.split(/[,，\s]+/);
      return {
        batchNo,
        quantity: Number(quantityRaw) || 0,
        producedAt: new Date().toISOString().slice(0, 10),
        note: rest.join(' ') || undefined
      };
    });
    traceStore.dispatch({
      type: 'split_batch',
      batchId: splitTarget,
      parts,
      actor: '生产质量窗口'
    });
    splitText = '';
    notify('批号已拆分，关联未签发报告将失效');
  }
</script>

<div class="space-y-4">
  {#if notice}
    <p class="rounded border border-teal-500/50 bg-teal-50/70 p-2 text-xs text-teal-900 dark:bg-teal-950/30 dark:text-teal-200">{notice}</p>
  {/if}

  <section class="rounded border border-surface-300-700 p-4">
    <h3 class="text-sm font-semibold">器械标识（UDI-DI）</h3>
    <div class="mt-3 overflow-x-auto">
      <table class="data-table text-sm">
        <thead>
          <tr><th>标识编码</th><th>产品 / 型号</th><th>生产商</th><th>版本</th></tr>
        </thead>
        <tbody>
          {#each $traceStore.udis as udi (udi.id)}
            <tr>
              <td class="font-mono">{udi.udiCode}</td>
              <td>{udi.productName} / {udi.model}</td>
              <td>{udi.manufacturer}</td>
              <td><span class="badge">R{udi.revision}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-3 grid gap-2 md:grid-cols-4">
      <label class="md:col-span-1">
        <span class="mb-1 block text-xs">选择标识</span>
        <select class="select select-sm" bind:value={udiId}>
          {#each $traceStore.udis as udi (udi.id)}
            <option value={udi.id}>{udi.udiCode}（R{udi.revision}）</option>
          {/each}
        </select>
      </label>
      <label class="md:col-span-1">
        <span class="mb-1 block text-xs">更正后编码</span>
        <input class="input input-sm" bind:value={newUdiCode} placeholder="新 UDI-DI" />
      </label>
      <label class="md:col-span-2">
        <span class="mb-1 block text-xs">更正原因</span>
        <input class="input input-sm" bind:value={udiReason} placeholder="生产商更正说明" />
      </label>
    </div>
    <button class="btn btn-sm mt-3 variant-filled-primary" type="button" onclick={correctUdi}>执行标识更正</button>
  </section>

  <section class="rounded border border-surface-300-700 p-4">
    <h3 class="text-sm font-semibold">注册证换版</h3>
    <div class="mt-3 overflow-x-auto">
      <table class="data-table text-sm">
        <thead>
          <tr><th>注册证编号</th><th>产品</th><th>当前版本</th><th>最近签发</th></tr>
        </thead>
        <tbody>
          {#each $traceStore.certificates as cert (cert.id)}
            <tr>
              <td class="font-medium">{cert.certNo}</td>
              <td>{cert.productName}</td>
              <td><span class="badge">V{cert.version}</span></td>
              <td>{shortDate(cert.issuedAt)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <div class="mt-3 grid gap-2 md:grid-cols-4">
      <label class="md:col-span-2">
        <span class="mb-1 block text-xs">选择注册证</span>
        <select class="select select-sm" bind:value={certId}>
          {#each $traceStore.certificates as cert (cert.id)}
            <option value={cert.id}>{cert.certNo}（V{cert.version}）</option>
          {/each}
        </select>
      </label>
      <label>
        <span class="mb-1 block text-xs">新版本号</span>
        <input class="input input-sm" type="number" min="1" bind:value={certVersion} placeholder="如 4" />
      </label>
      <label>
        <span class="mb-1 block text-xs">换版事由</span>
        <input class="input input-sm" bind:value={certReason} placeholder="适用范围更正等" />
      </label>
    </div>
    <button class="btn btn-sm mt-3 variant-filled-primary" type="button" onclick={reviseCert}>执行换版</button>
  </section>

  <section class="rounded border border-surface-300-700 p-4">
    <h3 class="text-sm font-semibold">生产批号</h3>
    <div class="mt-3 overflow-x-auto">
      <table class="data-table text-sm">
        <thead>
          <tr><th>批号</th><th>生产日期</th><th>数量</th><th>版本/状态</th><th>拆分去向</th></tr>
        </thead>
        <tbody>
          {#each $traceStore.batches as batch (batch.id)}
            {@const udi = $traceStore.udis.find((item) => item.id === batch.udiId)}
            <tr>
              <td class="font-medium">{batch.batchNo}</td>
              <td>{shortDate(batch.producedAt)}</td>
              <td>{batch.quantity}</td>
              <td>
                <span class="badge">R{batch.revision}</span>
                {#if batch.status === 'superseded'}
                  <span class="badge variant-soft-warning ml-1">已停用</span>
                {/if}
              </td>
              <td class="text-xs text-surface-500-400">
                {#if batch.replacedBy}
                  {batch.replacedBy
                    .map((id) => $traceStore.batches.find((item) => item.id === id)?.batchNo ?? id)
                    .join('、')}
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>

    <div class="mt-4 grid gap-4 lg:grid-cols-2">
      <div class="rounded bg-surface-200-800/60 p-3">
        <p class="text-xs font-semibold">批号更正</p>
        <div class="mt-2 space-y-2">
          <label class="block">
            <span class="mb-1 block text-xs">选择批号</span>
            <select class="select select-sm" bind:value={batchId}>
              {#each $traceStore.batches.filter((batch) => batch.status === 'active') as batch (batch.id)}
                <option value={batch.id}>{batch.batchNo}（R{batch.revision}）</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs">更正后批号</span>
            <input class="input input-sm" bind:value={newBatchNo} />
          </label>
          <label class="block">
            <span class="mb-1 block text-xs">更正原因</span>
            <input class="input input-sm" bind:value={batchReason} />
          </label>
          <button class="btn btn-sm variant-filled-secondary" type="button" onclick={correctBatch}>执行批号更正</button>
        </div>
      </div>

      <div class="rounded bg-surface-200-800/60 p-3">
        <p class="text-xs font-semibold">批号拆分</p>
        <div class="mt-2 space-y-2">
          <label class="block">
            <span class="mb-1 block text-xs">被拆分批号</span>
            <select class="select select-sm" bind:value={splitTarget}>
              <option value="">请选择</option>
              {#each $traceStore.batches.filter((batch) => batch.status === 'active') as batch (batch.id)}
                <option value={batch.id}>{batch.batchNo}</option>
              {/each}
            </select>
          </label>
          <label class="block">
            <span class="mb-1 block text-xs">拆分批号（每行：批号 数量 备注）</span>
            <textarea class="textarea textarea-sm" rows="3" bind:value={splitText} placeholder={'IP8-260401-A 600 供应商A\nIP8-260401-B 600 供应商B'}></textarea>
          </label>
          <button class="btn btn-sm variant-filled-secondary" type="button" onclick={splitBatch}>执行拆分</button>
        </div>
      </div>
    </div>
  </section>
</div>
