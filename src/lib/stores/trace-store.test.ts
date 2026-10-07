// @vitest-environment happy-dom
/**
 * store 端到端集成：派发动作 -> 持久化 -> 恢复 -> 重复导入 -> 并发冲突
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { traceStore } from './trace-store';
import { buildSeedTrace } from '$lib/trace/seed';

beforeEach(() => {
  window.localStorage.clear();
  traceStore.resetDemo();
});

describe('追溯台账 store', () => {
  it('种子加载后：待核、已失效、已签发复议项各就各位', () => {
    const state = traceStore.snapshot();
    expect(state.bindings.some((b) => b.verificationState === 'pending')).toBe(true);
    expect(state.reports.some((r) => r.status === 'invalidated')).toBe(true);
    const issued18 = state.reports.find((r) => r.signalId === 'SIG-2026-018')!;
    expect(issued18.status).toBe('issued');
    expect(issued18.reconsideration.length).toBe(2);
  });

  it('草稿签发后冻结依据；随后批号更正不改变冻结内容', () => {
    const before = traceStore.snapshot();
    const binding19 = before.bindings.find((b) => b.signalId === 'SIG-2026-019')!;
    const report19 = before.reports.find((r) => r.bindingId === binding19.id && r.status === 'draft')!;

    const issued = traceStore.dispatch({ type: 'issue_report', reportId: report19.id, actor: '顾岚' });
    expect(issued.recovered).toBe(false);

    const batchId = binding19.batchIds[0];
    traceStore.dispatch({
      type: 'correct_batch',
      batchId,
      newBatchNo: 'D9-260722R',
      reason: '喷码更正',
      actor: '厂商'
    });

    const after = traceStore.snapshot();
    const finalReport = after.reports.find((r) => r.id === report19.id)!;
    expect(finalReport.status).toBe('issued');
    expect(finalReport.frozenBasis!.batches[0].batchNo).toBe('D9-260722');
    expect(finalReport.reconsideration.some((item) => item.kind === 'batch_corrected')).toBe(true);
  });

  it('两个窗口同改一条链：先到生效，后到保留输入并产生冲突记录', () => {
    const state = traceStore.snapshot();
    const binding = state.bindings[0];
    const rev = binding.revision;

    const first = traceStore.dispatch({
      type: 'save_binding',
      bindingId: binding.id,
      expectedRevision: rev,
      actor: '窗口A',
      patch: {}
    });
    expect(first.conflict).toBeUndefined();

    const conflictsBefore = traceStore.snapshot().conflicts.length;
    const second = traceStore.dispatch({
      type: 'save_binding',
      bindingId: binding.id,
      expectedRevision: rev,
      actor: '窗口B',
      patch: { pendingReason: '窗口B的独立输入' }
    });
    expect(second.ok).toBe(false);
    expect(second.conflict?.actor).toBe('窗口B');
    expect(second.conflict?.attemptedInput).toMatchObject({
      patch: { pendingReason: '窗口B的独立输入' }
    });
    expect(traceStore.snapshot().conflicts.length).toBe(conflictsBefore + 1);
  });

  it('同一份导出包重复导入不新增数据也不新增审计', () => {
    const payload = buildSeedTrace();
    const eventsBefore = traceStore.snapshot().events.length;
    const first = traceStore.importState(payload, '集成测试');
    const eventsAfterFirst = traceStore.snapshot().events.length;
    expect(first.recovered).toBe(false);
    expect(eventsAfterFirst).toBeGreaterThanOrEqual(eventsBefore);

    const second = traceStore.importState(payload, '集成测试');
    void second;
    expect(traceStore.snapshot().events.length).toBe(eventsAfterFirst);
  });

  it('写入失败后从最近完整快照恢复，失败内容不泄漏且有恢复审计', () => {
    // 先产生一次成功写入，确保完整快照已落盘
    traceStore.dispatch({
      type: 'note_recovery',
      actor: '集成测试',
      detail: '恢复演练前的成功写入'
    });
    const goodEventCount = traceStore.snapshot().events.length;

    traceStore.armFailure();
    const outcome = traceStore.dispatch({
      type: 'note_recovery',
      actor: '集成测试',
      detail: '注定失败的写入内容'
    });

    expect(outcome.recovered).toBe(true);
    const state = traceStore.snapshot();
    expect(state.events.some((e) => e.detail.includes('注定失败的写入内容'))).toBe(false);
    expect(state.events[0].action).toBe('故障恢复');
    expect(state.events.length).toBe(goodEventCount + 1);
  });

  it('待核旧数据补齐标识版本后重算为草稿并可签发', () => {
    const state = traceStore.snapshot();
    const pending = state.bindings.find((b) => b.verificationState === 'pending')!;
    const report = state.reports.find((r) => r.bindingId === pending.id)!;
    expect(report.status).toBe('pending_verification');

    const udi = state.udis[0];
    const resolved = traceStore.dispatch({
      type: 'resolve_pending',
      bindingId: pending.id,
      expectedRevision: pending.revision,
      actor: '核实窗口',
      udiId: udi.id,
      udiRevision: udi.revision
    });
    expect(resolved.conflict).toBeUndefined();

    const after = traceStore.snapshot();
    const updated = after.reports.find((r) => r.id === report.id)!;
    expect(updated.status).toBe('draft');

    const issued = traceStore.dispatch({ type: 'issue_report', reportId: report.id, actor: '评审' });
    expect(issued.state.reports.find((r) => r.id === report.id)!.status).toBe('issued');
  });
});
