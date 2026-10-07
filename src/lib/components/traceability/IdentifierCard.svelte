<script lang="ts">
  import { enhance } from '$app/forms';
  import type {
    DeviceIdentifier,
    IdentifierConflict,
    ProductionLot,
    RegistrationCertificate,
    StoreResult
  } from '$lib/models/traceability';
  import { traceabilityStore } from '$lib/stores/traceability-store';

  export let identifier: DeviceIdentifier;
  export let cert: RegistrationCertificate | undefined;
  export let lots: ProductionLot[];
  export let reportCount: number;
  export let actor: string;
  export let onnotice: (notice: { kind: 'success' | 'error' | 'info'; text: string }) => void = () => {};

  let editing = false;
  let renewing = false;
  let completing = false;
  let splittingLotId: string | null = null;
  let localError = '';
  let conflict: IdentifierConflict | null = null;

  let draft = { baseVersion: 0, udi: '', productName: '', manufacturer: '', reason: '' };
  let renewDraft = { certNumber: '', validUntil: '', reason: '' };
  let completeDraft = { version: 1, note: '' };
  let splitDraft = { newLotNumbers: '', reason: '' };

  $: pending = identifier.status === 'pending_review';

  function publish(result: StoreResult, successText?: string) {
    if (result.ok) {
      onnotice({ kind: 'success', text: result.message ?? successText ?? '操作完成。' });
    } else if (result.recoveredFrom) {
      onnotice({
        kind: 'error',
        text: `${result.message}（恢复快照 ${result.recoveredFrom.id}）`
      });
    } else if (!result.conflict) {
      onnotice({ kind: 'error', text: result.message });
    }
  }

  function startEdit() {
    draft = {
      baseVersion: identifier.version ?? 0,
      udi: identifier.udi,
      productName: identifier.productName,
      manufacturer: identifier.manufacturer,
      reason: ''
    };
    conflict = null;
    localError = '';
    editing = true;
    renewing = false;
    completing = false;
  }

  function startRenew() {
    renewDraft = { certNumber: cert?.certNumber ?? '', validUntil: cert?.validUntil ?? '', reason: '' };
    localError = '';
    renewing = true;
    editing = false;
    completing = false;
  }

  function startComplete() {
    completeDraft = { version: (identifier.revisions.at(-1)?.version ?? 0) + 1, note: '' };
    localError = '';
    completing = true;
    editing = false;
    renewing = false;
  }

  function startSplit(lotId: string) {
    splitDraft = { newLotNumbers: '', reason: '' };
    localError = '';
    splittingLotId = splittingLotId === lotId ? null : lotId;
  }

  /** 冲突后用户选择“以最新版本为基准重试”：输入保留，仅更新基准版本号。 */
  function retryOnLatest() {
    if (!conflict) return;
    const result = traceabilityStore.correctIdentifier({
      id: identifier.id,
      baseVersion: conflict.currentVersion,
      udi: draft.udi,
      productName: draft.productName,
      manufacturer: draft.manufacturer,
      reason: draft.reason || `基于 V${conflict.currentVersion} 重新提交更正`,
      actor
    });
    if (result.ok) {
      conflict = null;
      editing = false;
    } else if (result.conflict) {
      conflict = result.conflict;
    }
    publish(result);
  }
</script>

<article class="rounded border border-surface-300-700 bg-surface-100-900 p-4">
  <div class="flex flex-wrap items-start justify-between gap-3">
    <div>
      <div class="flex flex-wrap items-center gap-2">
        <h3 class="font-semibold">{identifier.productName}</h3>
        {#if pending}
          <span class="badge bg-amber-100 text-amber-950">待核</span>
        {:else}
          <span class="badge bg-emerald-100 text-emerald-900">标识 V{identifier.version}</span>
        {/if}
      </div>
      <p class="mt-1 text-sm text-surface-600-300">
        UDI {identifier.udi} · {identifier.manufacturer}
      </p>
      <p class="mt-1 text-xs text-surface-500-400">
        注册证 {cert?.certNumber ?? '未关联'}
        {cert ? ` V${cert.version}（有效期至 ${cert.validUntil}）` : ''} · 关联报告 {reportCount} 份 · 更新于 {identifier.updatedAt.slice(0, 10)}
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      {#if pending}
        <button class="btn btn-sm variant-filled-primary" type="button" on:click={startComplete}>补齐版本</button>
      {:else}
        <button class="btn btn-sm variant-soft-primary" type="button" on:click={startEdit}>更正标识</button>
        <button class="btn btn-sm variant-soft-secondary" type="button" on:click={startRenew}>注册证换版</button>
      {/if}
    </div>
  </div>

  <div class="mt-3 flex flex-wrap gap-2">
    {#each lots as lot (lot.id)}
      <span
        class="badge px-2 py-1 {lot.status === 'split' ? 'bg-surface-200-800 line-through' : 'bg-teal-100 text-teal-950'}"
        title={lot.status === 'split' ? '已拆分' : `数量 ${lot.quantity}`}
      >
        {lot.lotNumber} V{lot.version}{lot.status === 'split' ? '（已拆分）' : ''}
      </span>
    {/each}
  </div>

  {#if !pending}
    <div class="mt-3 flex flex-wrap gap-2">
      {#each lots.filter((lot) => lot.status === 'active') as lot (lot.id)}
        <button class="btn btn-xs variant-ghost-surface" type="button" on:click={() => startSplit(lot.id)}>
          拆分 {lot.lotNumber}
        </button>
      {/each}
    </div>
  {/if}

  {#if localError}
    <p class="mt-3 rounded bg-error-100 p-2 text-sm text-error-900">{localError}</p>
  {/if}

  {#if conflict}
    <div class="mt-3 rounded border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
      <p class="font-medium">并发冲突：该标识已由 {conflict.current.lastActor} 更新为 V{conflict.currentVersion}</p>
      <p class="mt-1">
        您的修改基于 V{conflict.attemptedBaseVersion}，未生效；输入已保留在表单中。当前生效值：UDI {conflict.current.udi} · {conflict.current.productName} · {conflict.current.manufacturer}（{conflict.current.updatedAt.slice(0, 16).replace('T', ' ')}）
      </p>
      <div class="mt-2 flex flex-wrap gap-2">
        <button class="btn btn-sm variant-filled-primary" type="button" on:click={retryOnLatest}>以最新版本为基准重试</button>
        <button
          class="btn btn-sm variant-ghost-surface"
          type="button"
          on:click={() => {
            conflict = null;
            editing = false;
          }}
        >
          放弃修改
        </button>
      </div>
    </div>
  {/if}

  {#if editing}
    <form
      class="section-rule mt-4 grid gap-3 pt-4 md:grid-cols-2"
      method="POST"
      action="?/correct"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'failure') {
            localError = String((result.data as { message?: string } | undefined)?.message ?? '校验失败');
            return;
          }
          if (result.type === 'success') {
            const payload = (result.data as { correct?: typeof draft & { id: string; actor: string } }).correct;
            if (!payload) return;
            const storeResult = traceabilityStore.correctIdentifier(payload);
            if (storeResult.ok) {
              editing = false;
              conflict = null;
            } else if (storeResult.conflict) {
              conflict = storeResult.conflict;
            }
            publish(storeResult);
          }
        };
      }}
    >
      <input type="hidden" name="id" value={identifier.id} />
      <input type="hidden" name="baseVersion" value={draft.baseVersion} />
      <input type="hidden" name="actor" value={actor} />
      <p class="text-xs text-surface-500-400 md:col-span-2">基于版本 V{draft.baseVersion} 修改；若其他窗口已提交新版本，将提示冲突。</p>
      <label>
        <span class="mb-1 block text-sm font-medium">器械唯一标识（UDI）</span>
        <input class="input" name="udi" bind:value={draft.udi} required minlength="6" />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">产品名称</span>
        <input class="input" name="productName" bind:value={draft.productName} required />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">生产商</span>
        <input class="input" name="manufacturer" bind:value={draft.manufacturer} required />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">更正原因</span>
        <input class="input" name="reason" bind:value={draft.reason} required minlength="4" placeholder="如：生产商更正标识载体" />
      </label>
      <div class="flex gap-2 md:col-span-2">
        <button class="btn variant-filled-primary" type="submit">提交更正</button>
        <button class="btn variant-ghost-surface" type="button" on:click={() => (editing = false)}>取消</button>
      </div>
    </form>
  {/if}

  {#if renewing && cert}
    <form
      class="section-rule mt-4 grid gap-3 pt-4 md:grid-cols-2"
      method="POST"
      action="?/renewCert"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'failure') {
            localError = String((result.data as { message?: string } | undefined)?.message ?? '校验失败');
            return;
          }
          if (result.type === 'success') {
            const payload = (result.data as { renewCert?: Parameters<typeof traceabilityStore.renewCertificate>[0] }).renewCert;
            if (!payload) return;
            const storeResult = traceabilityStore.renewCertificate(payload);
            if (storeResult.ok) renewing = false;
            publish(storeResult);
          }
        };
      }}
    >
      <input type="hidden" name="certId" value={cert.id} />
      <input type="hidden" name="actor" value={actor} />
      <label>
        <span class="mb-1 block text-sm font-medium">注册证编号</span>
        <input class="input" name="certNumber" bind:value={renewDraft.certNumber} required minlength="6" />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">有效期至</span>
        <input class="input" name="validUntil" type="date" bind:value={renewDraft.validUntil} required />
      </label>
      <label class="md:col-span-2">
        <span class="mb-1 block text-sm font-medium">换版原因</span>
        <input class="input" name="reason" bind:value={renewDraft.reason} required minlength="4" placeholder="如：标准升级换版" />
      </label>
      <div class="flex gap-2 md:col-span-2">
        <button class="btn variant-filled-secondary" type="submit">提交换版（V{cert.version} → V{cert.version + 1}）</button>
        <button class="btn variant-ghost-surface" type="button" on:click={() => (renewing = false)}>取消</button>
      </div>
    </form>
  {/if}

  {#if completing}
    <form
      class="section-rule mt-4 grid gap-3 pt-4 md:grid-cols-2"
      method="POST"
      action="?/complete"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'failure') {
            localError = String((result.data as { message?: string } | undefined)?.message ?? '校验失败');
            return;
          }
          if (result.type === 'success') {
            const payload = (result.data as { complete?: Parameters<typeof traceabilityStore.completeReview>[0] }).complete;
            if (!payload) return;
            const storeResult = traceabilityStore.completeReview(payload);
            if (storeResult.ok) completing = false;
            publish(storeResult);
          }
        };
      }}
    >
      <input type="hidden" name="id" value={identifier.id} />
      <input type="hidden" name="actor" value={actor} />
      <p class="rounded bg-amber-100 p-2 text-sm text-amber-950 md:col-span-2">
        该记录来自旧数据，缺少标识版本。补齐后将解除待核，并重算关联的追溯报告。
      </p>
      <label>
        <span class="mb-1 block text-sm font-medium">补录版本号</span>
        <input class="input" name="version" type="number" min="1" bind:value={completeDraft.version} required />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">补齐说明</span>
        <input class="input" name="note" bind:value={completeDraft.note} required minlength="4" placeholder="如：与注册档案核对后补录" />
      </label>
      <div class="flex gap-2 md:col-span-2">
        <button class="btn variant-filled-primary" type="submit">补齐并重算</button>
        <button class="btn variant-ghost-surface" type="button" on:click={() => (completing = false)}>取消</button>
      </div>
    </form>
  {/if}

  {#if splittingLotId}
    <form
      class="section-rule mt-4 grid gap-3 pt-4 md:grid-cols-2"
      method="POST"
      action="?/split"
      use:enhance={() => {
        return async ({ result }) => {
          if (result.type === 'failure') {
            localError = String((result.data as { message?: string } | undefined)?.message ?? '校验失败');
            return;
          }
          if (result.type === 'success') {
            const payload = (result.data as { split?: Parameters<typeof traceabilityStore.splitLot>[0] }).split;
            if (!payload) return;
            const storeResult = traceabilityStore.splitLot(payload);
            if (storeResult.ok) splittingLotId = null;
            publish(storeResult);
          }
        };
      }}
    >
      <input type="hidden" name="lotId" value={splittingLotId} />
      <input type="hidden" name="actor" value={actor} />
      <label>
        <span class="mb-1 block text-sm font-medium">拆分后批号（逗号分隔，至少两个）</span>
        <input class="input" name="newLotNumbers" bind:value={splitDraft.newLotNumbers} required placeholder="如：IP8-260401A, IP8-260401B" />
      </label>
      <label>
        <span class="mb-1 block text-sm font-medium">拆分原因</span>
        <input class="input" name="reason" bind:value={splitDraft.reason} required minlength="4" placeholder="如：按灭菌批次细分" />
      </label>
      <div class="flex gap-2 md:col-span-2">
        <button class="btn variant-filled-primary" type="submit">确认拆分</button>
        <button class="btn variant-ghost-surface" type="button" on:click={() => (splittingLotId = null)}>取消</button>
      </div>
    </form>
  {/if}

  {#if identifier.revisions.length > 0}
    <details class="mt-4 text-sm">
      <summary class="cursor-pointer text-surface-500-400">版本履历（{identifier.revisions.length}）</summary>
      <div class="mt-2 space-y-2">
        {#each [...identifier.revisions].reverse() as revision (revision.version)}
          <p class="text-xs text-surface-600-300">
            V{revision.version} · {revision.changedAt.slice(0, 10)} · {revision.actor}：{revision.reason}
          </p>
        {/each}
      </div>
    </details>
  {/if}
</article>
