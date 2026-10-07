import { browser } from '$app/environment';
import { get, writable } from 'svelte/store';
import {
  type TraceAction
} from '$lib/trace/engine';
import {
  armWriteFailure,
  hardReset,
  loadInitialState,
  persistCommit,
  type PersistOutcome
} from '$lib/trace/persistence';
import { buildSeedTrace } from '$lib/trace/seed';
import { stableHash } from '$lib/trace/engine';
import type {
  AuditReport,
  DeviceUdi,
  EditConflict,
  ProductionBatch,
  RegistrationCertificate,
  TraceBinding,
  TraceEvent,
  TraceState
} from '$lib/trace/types';

const initial = loadInitialState(() => buildSeedTrace());
const internal = writable<TraceState>(initial);

function dispatch(action: TraceAction): PersistOutcome {
  const current = get(internal);
  const outcome = persistCommit(current, action);
  internal.set(outcome.state);
  return outcome;
}

export const traceStore = {
  subscribe: internal.subscribe,

  dispatch,

  /** 供测试/纯计算场景直接拿当前状态 */
  snapshot(): TraceState {
    return get(internal);
  },

  resetDemo() {
    const seed = buildSeedTrace();
    hardReset(seed);
    internal.set(seed);
  },

  armFailure() {
    armWriteFailure();
  },

  /**
   * 重复导入判重：同一载荷指纹第二次导入不新增数据、不新增审计。
   * 载荷应为完整 TraceState（例如另一环境导出的追溯包）。
   */
  importState(payload: TraceState, actor: string): PersistOutcome {
    const payloadHash = stableHash(stripVolatile(payload));
    return dispatch({
      type: 'import_snapshot',
      payloadHash,
      actor,
      apply: () => normalizeImport(payload)
    });
  }
};

/** 导入时去掉易变字段，使"同一批数据二次导入"指纹一致 */
function stripVolatile(state: TraceState): unknown {
  return {
    udis: state.udis.map(({ id, ...rest }) => rest),
    certificates: state.certificates.map(({ id, ...rest }) => rest),
    batches: state.batches.map(({ id, ...rest }) => rest),
    bindings: state.bindings.map(({ id, ...rest }) => rest),
    reports: state.reports.map(({ id: _id, ...rest }) => rest)
  };
}

/**
 * 合并导入：保留现有数据，追加导入中的实体并重映射 id 关联。
 * 对种子/演示而言，整份导入也可直接使用；这里采用以业务编码判重的合并策略。
 */
function normalizeImport(incoming: TraceState): TraceState {
  const base = get(internal);
  const merged: TraceState = structuredClone(base);

  const udiIdMap = new Map<string, string>();
  for (const udi of incoming.udis) {
    const existing = merged.udis.find((item) => item.udiCode === udi.udiCode);
    if (existing) {
      udiIdMap.set(udi.id, existing.id);
    } else {
      const clone: DeviceUdi = { ...structuredClone(udi), id: `IMP-UDI-${merged.seq + 1}` };
      merged.seq += 1;
      udiIdMap.set(udi.id, clone.id);
      merged.udis.push(clone);
    }
  }

  const certIdMap = new Map<string, string>();
  for (const cert of incoming.certificates) {
    const existing = merged.certificates.find(
      (item) => item.certNo === cert.certNo && item.version === cert.version
    );
    if (existing) {
      certIdMap.set(cert.id, existing.id);
    } else {
      const clone: RegistrationCertificate = {
        ...structuredClone(cert),
        id: `IMP-CER-${merged.seq + 1}`
      };
      merged.seq += 1;
      certIdMap.set(cert.id, clone.id);
      merged.certificates.push(clone);
    }
  }

  const batchIdMap = new Map<string, string>();
  for (const batch of incoming.batches) {
    const mappedUdi = udiIdMap.get(batch.udiId) ?? batch.udiId;
    const existing = merged.batches.find(
      (item) => item.batchNo === batch.batchNo && item.udiId === mappedUdi
    );
    if (existing) {
      batchIdMap.set(batch.id, existing.id);
    } else {
      const clone: ProductionBatch = {
        ...structuredClone(batch),
        id: `IMP-BAT-${merged.seq + 1}`,
        udiId: mappedUdi
      };
      merged.seq += 1;
      batchIdMap.set(batch.id, clone.id);
      merged.batches.push(clone);
    }
  }

  for (const binding of incoming.bindings) {
    const exists = merged.bindings.some((item) => item.signalId === binding.signalId);
    if (exists) continue;
    const clone: TraceBinding = {
      ...structuredClone(binding),
      id: `IMP-BND-${merged.seq + 1}`,
      udiId: udiIdMap.get(binding.udiId) ?? binding.udiId,
      certId: certIdMap.get(binding.certId) ?? binding.certId,
      batchIds: binding.batchIds.map((id) => batchIdMap.get(id) ?? id)
    };
    merged.seq += 1;
    clone.evidence = clone.evidence.map((ev) => ({
      ...ev,
      batchId: batchIdMap.get(ev.batchId) ?? ev.batchId
    }));
    merged.bindings.push(clone);
  }

  for (const report of incoming.reports) {
    const exists = merged.reports.some(
      (item) => item.signalId === report.signalId && item.title === report.title
    );
    if (exists) continue;
    const mappedBinding =
      merged.bindings.find((item) => item.signalId === report.signalId)?.id ?? report.bindingId;
    const clone: AuditReport = {
      ...structuredClone(report),
      id: `IMP-RPT-${merged.seq + 1}`,
      bindingId: mappedBinding
    };
    merged.seq += 1;
    merged.reports.unshift(clone);
  }

  return merged;
}

export function exportTraceBundle(): string {
  const state = get(internal);
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      payloadHash: stableHash(stripVolatile(state)),
      state
    },
    null,
    2
  );
}

// ── 选择器 ────────────────────────────────────────────────────────
export function bindingReports(state: TraceState, bindingId: string): AuditReport[] {
  return state.reports.filter((report) => report.bindingId === bindingId);
}

export function openConflicts(state: TraceState): EditConflict[] {
  return state.conflicts.filter((conflict) => conflict.status === 'open');
}

export function pendingBindings(state: TraceState): TraceBinding[] {
  return state.bindings.filter((binding) => binding.verificationState === 'pending');
}

export function recentEvents(state: TraceState, limit = 30): TraceEvent[] {
  return state.events.slice(0, limit);
}

/** 供控制台/调试：浏览器里可查看台账 */
if (browser) {
  (window as unknown as { __traceStore?: unknown }).__traceStore = traceStore;
}
