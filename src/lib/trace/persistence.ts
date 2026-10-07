/**
 * 持久化与故障恢复
 *
 * 写入流程：先校验当前主状态完整 -> commit -> 校验结果完整 ->
 * 落主状态 -> 周期性保存"完整追溯快照"。
 * 任一步骤失败（含模拟故障），立即从最近完整快照恢复，并记录恢复事件。
 */
import { browser } from '$app/environment';
import { commit, emptyState, stableHash, type TraceAction } from './engine';
import type { TraceSnapshot, TraceState } from './types';

const MAIN_KEY = 'medical-safety-trace-v1';
const SNAPSHOT_KEY = 'medical-safety-trace-snapshots-v1';
const MAX_SNAPSHOTS = 5;

/** 演示/测试开关：置位后下一次写入必失败，随后自动复位 */
let failNextWrite = false;

export function armWriteFailure(): void {
  failNextWrite = true;
}

export interface PersistOutcome {
  ok: boolean;
  state: TraceState;
  recovered: boolean;
  recoveryDetail?: string;
  conflict?: import('./types').EditConflict;
  event?: import('./types').TraceEvent;
}

export function isStateIntact(state: unknown): state is TraceState {
  if (!state || typeof state !== 'object') return false;
  const s = state as Record<string, unknown>;
  return (
    Array.isArray(s.udis) &&
    Array.isArray(s.certificates) &&
    Array.isArray(s.batches) &&
    Array.isArray(s.bindings) &&
    Array.isArray(s.reports) &&
    Array.isArray(s.events) &&
    Array.isArray(s.conflicts) &&
    Array.isArray(s.importHashes) &&
    typeof s.seq === 'number'
  );
}

function rawStorage(): Storage | null {
  if (!browser) return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSnapshots(): TraceSnapshot[] {
  const storage = rawStorage();
  if (!storage) return [];
  try {
    const raw = storage.getItem(SNAPSHOT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Array<{ checksum: string; snapshot: TraceSnapshot }>;
    return parsed
      .filter((entry) => stableHash(entry.snapshot.state) === entry.checksum)
      .map((entry) => entry.snapshot);
  } catch {
    return [];
  }
}

function saveSnapshots(snapshots: TraceSnapshot[]): void {
  const storage = rawStorage();
  if (!storage) return;
  const envelope = snapshots.slice(0, MAX_SNAPSHOTS).map((snapshot) => ({
    snapshot,
    checksum: stableHash(snapshot.state)
  }));
  storage.setItem(SNAPSHOT_KEY, JSON.stringify(envelope));
}

/** 保存一份完整追溯快照（每次成功写入后调用） */
export function takeSnapshot(state: TraceState, reason: string): TraceSnapshot | null {
  const storage = rawStorage();
  if (!storage) return null;
  const snapshot: TraceSnapshot = {
    id: `SNP-${state.seq}-${Date.now().toString(36)}`,
    createdAt: new Date().toISOString(),
    state: structuredClone(state),
    reason
  };
  const snapshots = [snapshot, ...loadSnapshots()].slice(0, MAX_SNAPSHOTS);
  saveSnapshots(snapshots);
  return snapshot;
}

/** 从最近一份校验通过的完整快照恢复；没有快照则退回空状态 */
export function restoreFromSnapshot(reason: string): {
  state: TraceState;
  snapshot?: TraceSnapshot;
} {
  const snapshots = loadSnapshots();
  const latest = snapshots[0];
  if (latest) {
    const recovered = structuredClone(latest.state);
    const noted = commit(recovered, {
      type: 'note_recovery',
      actor: '恢复程序',
      detail: `${reason}；已从最近完整追溯快照 ${latest.id}（${latest.createdAt}，事由：${latest.reason}）恢复。`
    });
    return { state: noted.state, snapshot: latest };
  }
  const fallback = emptyState();
  const noted = commit(fallback, {
    type: 'note_recovery',
    actor: '恢复程序',
    detail: `${reason}；无可用快照，已回退到空追溯状态，等待重新导入。`
  });
  return { state: noted.state };
}

export function loadInitialState(fallback: () => TraceState): TraceState {
  const storage = rawStorage();
  if (!storage) return fallback();
  try {
    const raw = storage.getItem(MAIN_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as TraceState;
      if (isStateIntact(parsed)) return parsed;
    }
  } catch {
    // 主状态损坏，落到快照恢复
  }
  const restored = restoreFromSnapshot('启动时发现主状态损坏');
  if (restored.snapshot) {
    storage.setItem(MAIN_KEY, JSON.stringify(restored.state));
  }
  return restored.snapshot ? restored.state : fallback();
}

function writeMain(state: TraceState): void {
  const storage = rawStorage();
  if (!storage) return;
  if (failNextWrite) {
    failNextWrite = false;
    throw new Error('模拟写入失败：存储通道不可用');
  }
  const serialized = JSON.stringify(state);
  storage.setItem(MAIN_KEY, serialized);
}

/**
 * 带故障恢复的写入。返回的 state 始终是"当前可信状态"：
 * 成功时为新状态；失败恢复后为快照状态。
 */
export function persistCommit(
  current: TraceState,
  action: TraceAction,
  snapshotReason = '最近完整追溯快照'
): PersistOutcome {
  // 写入前：确保有一份完整快照可回退
  if (loadSnapshots().length === 0) {
    takeSnapshot(current, '初始基线快照');
  }

  let result;
  try {
    result = commit(current, action);
  } catch (error) {
    // commit 本身抛错（业务校验），状态不变，不算写入故障
    throw error;
  }

  if (!result.ok) {
    // 乐观锁冲突：业务数据未推进版本，但冲突记录与后到输入必须持久保留
    try {
      writeMain(result.state);
    } catch {
      // 冲突记录落盘失败时退回内存态；下一次写入会重试持久化
    }
    return {
      ok: false,
      state: result.state,
      recovered: false,
      conflict: result.conflict,
      event: result.event
    };
  }

  if (!isStateIntact(result.state)) {
    const recovered = restoreFromSnapshot('提交后状态完整性校验未通过');
    return {
      ok: true,
      state: recovered.state,
      recovered: true,
      recoveryDetail: '提交结果结构不完整，已恢复快照'
    };
  }

  try {
    writeMain(result.state);
  } catch (error) {
    // 写入失败 -> 从最近完整追溯快照恢复
    const recovered = restoreFromSnapshot(
      `写入失败（${error instanceof Error ? error.message : '未知错误'}）`
    );
    try {
      writeMain(recovered.state);
      takeSnapshot(recovered.state, '故障恢复后的完整快照');
    } catch {
      // 恢复状态也无法落盘时仅返回内存态，等下一次写入重试
    }
    return {
      ok: true,
      state: recovered.state,
      recovered: true,
      recoveryDetail: recovered.snapshot
        ? `写入失败，已从快照 ${recovered.snapshot.id} 恢复`
        : '写入失败且无可用快照，已回到空状态'
    };
  }

  // 每次成功写入后滚动保存完整快照，保证恢复点不落后于最后一次成功写入
  takeSnapshot(result.state, snapshotReason);

  return { ok: true, state: result.state, recovered: false, event: result.event };
}

/** 强制重置（页面"重置演示数据"使用） */
export function hardReset(state: TraceState): void {
  const storage = rawStorage();
  if (!storage) return;
  storage.setItem(MAIN_KEY, JSON.stringify(state));
  saveSnapshots([]);
  takeSnapshot(state, '重置后的基线快照');
}
