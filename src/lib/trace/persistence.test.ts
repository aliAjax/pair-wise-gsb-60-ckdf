/**
 * 持久化 / 快照恢复测试。
 * 用内存版 Storage 模拟 localStorage，避免依赖浏览器。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { armWriteFailure, isStateIntact, persistCommit, restoreFromSnapshot } from './persistence';
import { buildSeedTrace } from './seed';

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  readonly length = 0;
  clear() {
    this.map.clear();
  }
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  key() {
    return null;
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage }
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage
  });
});

describe('写入失败后从最近完整快照恢复', () => {
  it('写入抛错时回滚到快照，且追加故障恢复事件', () => {
    const seed = buildSeedTrace();
    storage.setItem('medical-safety-trace-v1', JSON.stringify(seed));

    // 先做一次成功写入建立快照基线
    const ok = persistCommit(seed, {
      type: 'note_recovery',
      actor: '测试',
      detail: '基线写入'
    });
    expect(ok.recovered).toBe(false);

    armWriteFailure();
    const recovered = persistCommit(ok.state, {
      type: 'note_recovery',
      actor: '测试',
      detail: '本应失败的写入'
    });

    expect(recovered.recovered).toBe(true);
    expect(recovered.recoveryDetail).toContain('快照');
    // 失败写入的内容没有进入恢复后的状态
    const leaked = recovered.state.events.find(
      (event) => event.detail === '本应失败的写入'
    );
    expect(leaked).toBeUndefined();
    // 恢复动作本身有审计
    expect(recovered.state.events[0].action).toBe('故障恢复');
  });

  it('无完整快照可恢复时回退到空状态而不是半截数据', () => {
    // 存储中没有任何完整快照（快照键不存在）
    const recovered = restoreFromSnapshot('快照通道不可用');
    expect(recovered.snapshot).toBeUndefined();
    expect(isStateIntact(recovered.state)).toBe(true);
    expect(recovered.state.udis).toHaveLength(0);
    expect(recovered.state.events[0].detail).toContain('空追溯状态');
  });
});

describe('种子数据完整性', () => {
  it('包含待核旧数据、已签发带复议项报告、已失效草稿', () => {
    const seed = buildSeedTrace();
    expect(seed.bindings.some((b) => b.verificationState === 'pending')).toBe(true);
    const rpt18 = seed.reports.find((r) => r.signalId === 'SIG-2026-018');
    expect(rpt18?.status).toBe('issued');
    expect(rpt18?.frozenBasis).toBeDefined();
    expect(rpt18?.reconsideration.map((item) => item.kind).sort()).toEqual([
      'batch_split',
      'cert_revised'
    ]);
    const rpt15 = seed.reports.find((r) => r.signalId === 'SIG-2026-015');
    expect(rpt15?.status).toBe('invalidated');
    const rpt19 = seed.reports.find((r) => r.signalId === 'SIG-2026-019');
    expect(rpt19?.status).toBe('draft');
  });

  it('一个标识关联多个批号', () => {
    const seed = buildSeedTrace();
    const udi18 = seed.udis.find((u) => u.udiCode === '06901234000181');
    const batchesOfUdi = seed.batches.filter((b) => b.udiId === udi18!.id);
    expect(batchesOfUdi.length).toBeGreaterThanOrEqual(4);
  });
});
