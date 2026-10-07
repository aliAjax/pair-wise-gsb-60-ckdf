<script lang="ts">
  import BindingCard from '$lib/components/trace/BindingCard.svelte';
  import ConflictsPanel from '$lib/components/trace/ConflictsPanel.svelte';
  import MasterDataPanel from '$lib/components/trace/MasterDataPanel.svelte';
  import PendingPanel from '$lib/components/trace/PendingPanel.svelte';
  import RecoveryPanel from '$lib/components/trace/RecoveryPanel.svelte';
  import { traceStore } from '$lib/stores/trace-store';

  const tabs = [
    { id: 'chains', label: '追溯链与报告' },
    { id: 'master', label: '标识 / 注册证 / 批号' },
    { id: 'pending', label: '待核补齐' },
    { id: 'conflicts', label: '并发冲突' },
    { id: 'recovery', label: '恢复与导入' }
  ] as const;

  type TabId = (typeof tabs)[number]['id'];
  let activeTab: TabId = 'chains';

  $: state = $traceStore;
  $: metrics = [
    {
      label: '追溯链',
      value: state.bindings.length,
      note: `标识 ${state.udis.length} · 批号 ${state.batches.length}`
    },
    {
      label: '未签发报告',
      value: state.reports.filter((report) => report.status === 'draft').length,
      note: '依据变更即失效'
    },
    {
      label: '已失效草稿',
      value: state.reports.filter((report) => report.status === 'invalidated').length,
      note: '批号/注册证变更触发'
    },
    {
      label: '已签发报告复议项',
      value: state.reports.reduce(
        (sum, report) => sum + report.reconsideration.filter((item) => !item.resolved).length,
        0
      ),
      note: '原依据冻结保留'
    },
    {
      label: '待核（旧数据）',
      value: state.bindings.filter((binding) => binding.verificationState === 'pending').length,
      note: '补齐标识后重算'
    },
    {
      label: '未处理冲突',
      value: state.conflicts.filter((conflict) => conflict.status === 'open').length,
      note: '后到输入已保留'
    }
  ];
</script>

<svelte:head><title>标识追溯 | 医疗器械安全信号核查平台</title></svelte:head>

<div class="mb-6">
  <p class="text-sm font-medium text-teal-700">监管核查 · UDI 追溯</p>
  <h1 class="mt-1 text-2xl font-semibold">器械标识追溯台账</h1>
  <p class="mt-2 max-w-4xl text-sm text-surface-600-300">
    器械唯一标识、注册证、生产批号与信号证据接成版本化追溯链：一个标识关联多个批号；
    批号或注册证变更时，未签发报告立即失效，已签发报告冻结原依据并登记复议项。
  </p>
</div>

<section class="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
  {#each metrics as metric}
    <article class="rounded border border-surface-300-700 bg-surface-100-900 p-3">
      <p class="text-xs text-surface-500-400">{metric.label}</p>
      <p class="metric-value mt-1 text-2xl font-semibold">{metric.value}</p>
      <p class="mt-1 text-[11px] text-surface-500-400">{metric.note}</p>
    </article>
  {/each}
</section>

<div class="mb-5 flex flex-wrap gap-1 border-b border-surface-300-700">
  {#each tabs as tab}
    <button
      type="button"
      class="btn btn-sm -mb-px rounded-b-none {activeTab === tab.id
        ? 'variant-filled-primary'
        : 'variant-ghost-surface'}"
      onclick={() => (activeTab = tab.id)}
    >
      {tab.label}
      {#if tab.id === 'pending'}
        {@const pendingCount = state.bindings.filter((binding) => binding.verificationState === 'pending').length}
        {#if pendingCount > 0}<span class="ml-1 badge variant-soft-warning">{pendingCount}</span>{/if}
      {/if}
      {#if tab.id === 'conflicts'}
        {@const openCount = state.conflicts.filter((conflict) => conflict.status === 'open').length}
        {#if openCount > 0}<span class="ml-1 badge variant-soft-warning">{openCount}</span>{/if}
      {/if}
    </button>
  {/each}
</div>

{#if activeTab === 'chains'}
  <section class="space-y-4">
    {#each state.bindings as binding (binding.id)}
      {@const udi = state.udis.find((item) => item.id === binding.udiId)}
      {@const cert = state.certificates.find((item) => item.id === binding.certId)}
      {@const batches = binding.batchIds
        .map((id) => state.batches.find((batch) => batch.id === id))
        .filter((batch): batch is NonNullable<typeof batch> => Boolean(batch))}
      <BindingCard
        {binding}
        udiCode={udi?.udiCode ?? '待核（UDI 缺失）'}
        certNo={cert?.certNo ?? '注册证缺失'}
        batchNos={batches.map((batch) => batch.batchNo)}
      />
    {/each}
  </section>
{:else if activeTab === 'master'}
  <MasterDataPanel />
{:else if activeTab === 'pending'}
  <PendingPanel />
{:else if activeTab === 'conflicts'}
  <ConflictsPanel />
{:else}
  <RecoveryPanel />
{/if}
