/**
 * 追溯引擎规则测试（纯状态机，不依赖浏览器/localStorage）
 */
import { describe, expect, it } from 'vitest';
import {
  commit,
  createBatch,
  createBinding,
  createCertificate,
  createReport,
  createUdi,
  emptyState,
  stableHash,
  type TraceAction
} from './engine';
import type { TraceState } from './types';

function fixture(): {
  state: TraceState;
  draftId: string;
  issuedId: string;
  bindingId: string;
  batchId: string;
  udiId: string;
  certId: string;
} {
  let state = emptyState();
  const udi = createUdi(state, {
    udiCode: '06900000000001',
    productName: '测试泵',
    manufacturer: '测试厂商',
    model: 'TP-1'
  });
  const cert = createCertificate(state, {
    certNo: '国械注准TEST01',
    version: 1,
    productName: '测试泵',
    issuer: 'NMPA'
  });
  const batch = createBatch(state, {
    batchNo: 'B-001',
    udiId: udi.id,
    manufacturer: '测试厂商',
    producedAt: '2026-01-01',
    quantity: 100
  });
  const binding = createBinding(state, {
    signalId: 'SIG-T-1',
    signalTitle: '测试信号',
    udiId: udi.id,
    certId: cert.id,
    batchIds: [batch.id]
  });
  const draft = createReport(state, {
    bindingId: binding.id,
    signalId: 'SIG-T-1',
    title: '草稿报告',
    author: '甲'
  });
  const issued = createReport(state, {
    bindingId: binding.id,
    signalId: 'SIG-T-1',
    title: '正式报告',
    author: '甲'
  });
  state = commit(state, { type: 'issue_report', reportId: issued.id, actor: '甲' }).state;
  return {
    state,
    draftId: draft.id,
    issuedId: issued.id,
    bindingId: binding.id,
    batchId: batch.id,
    udiId: udi.id,
    certId: cert.id
  };
}

function statusOf(state: TraceState, id: string) {
  return state.reports.find((report) => report.id === id)!.status;
}

describe('依据变更传播', () => {
  it('批号更正：未签发草稿立即失效，已签发报告保留依据并登记复议项', () => {
    const setup = fixture();
    const frozenBefore = structuredClone(
      setup.state.reports.find((r) => r.id === setup.issuedId)!.frozenBasis
    );

    const result = commit(setup.state, {
      type: 'correct_batch',
      batchId: setup.batchId,
      newBatchNo: 'B-001-R',
      reason: '喷码错误',
      actor: '厂商'
    });

    expect(result.ok).toBe(true);
    expect(statusOf(result.state, setup.draftId)).toBe('invalidated');
    const draft = result.state.reports.find((r) => r.id === setup.draftId)!;
    expect(draft.invalidReason).toContain('批号更正');

    const issued = result.state.reports.find((r) => r.id === setup.issuedId)!;
    expect(issued.status).toBe('issued');
    expect(issued.frozenBasis).toEqual(frozenBefore);
    expect(issued.reconsideration).toHaveLength(1);
    expect(issued.reconsideration[0].kind).toBe('batch_corrected');
  });

  it('批号拆分：链挂入新批号，已签发报告追加拆分复议项，原批留在冻结依据', () => {
    const setup = fixture();
    const result = commit(setup.state, {
      type: 'split_batch',
      batchId: setup.batchId,
      parts: [
        { batchNo: 'B-001-A', producedAt: '2026-01-01', quantity: 50 },
        { batchNo: 'B-001-B', producedAt: '2026-01-01', quantity: 50 }
      ],
      actor: '厂商'
    });

    const binding = result.state.bindings.find((b) => b.id === setup.bindingId)!;
    const newBatches = result.state.batches.filter((b) =>
      ['B-001-A', 'B-001-B'].includes(b.batchNo)
    );
    expect(newBatches).toHaveLength(2);
    expect(binding.batchIds).toEqual(
      expect.arrayContaining([setup.batchId, ...newBatches.map((b) => b.id)])
    );

    const issued = result.state.reports.find((r) => r.id === setup.issuedId)!;
    expect(issued.reconsideration[0].kind).toBe('batch_split');
    expect(issued.frozenBasis!.batches.map((b) => b.batchNo)).toEqual(['B-001']);

    expect(statusOf(result.state, setup.draftId)).toBe('invalidated');
  });

  it('注册证换版：草稿失效，已签发报告登记 cert_revised 复议项', () => {
    const setup = fixture();
    const result = commit(setup.state, {
      type: 'revise_certificate',
      certId: setup.certId,
      newVersion: 2,
      reason: '适用范围更正',
      actor: '注册专员'
    });

    const binding = result.state.bindings.find((b) => b.id === setup.bindingId)!;
    expect(binding.certVersion).toBe(2);
    expect(statusOf(result.state, setup.draftId)).toBe('invalidated');
    const issued = result.state.reports.find((r) => r.id === setup.issuedId)!;
    expect(issued.reconsideration[0].kind).toBe('cert_revised');
    expect(issued.frozenBasis!.certVersion).toBe(1);
  });

  it('标识更正：链 udiRevision 跟随，两类报告按规则处理', () => {
    const setup = fixture();
    const result = commit(setup.state, {
      type: 'correct_udi',
      udiId: setup.udiId,
      newCode: '06900000009999',
      reason: '生产商编码更正',
      actor: '厂商'
    });

    const binding = result.state.bindings.find((b) => b.id === setup.bindingId)!;
    expect(binding.udiRevision).toBe(2);
    const issued = result.state.reports.find((r) => r.id === setup.issuedId)!;
    expect(issued.frozenBasis!.udiRevision).toBe(1);
    expect(issued.reconsideration[0].kind).toBe('udi_corrected');
  });

  it('同一变更重复传播不会给已签发报告重复挂相同复议项', () => {
    let setup = fixture();
    // 换版两次，每次只应新增一条复议项
    setup = {
      ...setup,
      state: commit(setup.state, {
        type: 'revise_certificate',
        certId: setup.certId,
        newVersion: 2,
        reason: '第一次',
        actor: '甲'
      }).state
    };
    const again = commit(setup.state, {
      type: 'correct_udi',
      udiId: setup.udiId,
      newCode: '06900000009999',
      reason: '标识更正',
      actor: '甲'
    });
    const issued = again.state.reports.find((r) => r.id === setup.issuedId)!;
    expect(issued.reconsideration.map((item) => item.kind).sort()).toEqual([
      'cert_revised',
      'udi_corrected'
    ]);
  });
});

describe('乐观并发：两个窗口同时改同一标识', () => {
  it('先到版本生效，后到提交被拦截并保留输入为冲突记录', () => {
    const setup = fixture();
    const baseRevision = setup.state.bindings[0].revision;

    const first = commit(setup.state, {
      type: 'save_binding',
      bindingId: setup.bindingId,
      expectedRevision: baseRevision,
      actor: '窗口A',
      patch: { batchIds: [setup.batchId] }
    });
    expect(first.ok).toBe(true);

    const second = commit(first.state, {
      type: 'save_binding',
      bindingId: setup.bindingId,
      expectedRevision: baseRevision, // 仍旧版本
      actor: '窗口B',
      patch: { pendingReason: '窗口B的输入' }
    });
    expect(second.ok).toBe(false);
    expect(second.conflict).toMatchObject({
      expectedRevision: baseRevision,
      actualRevision: baseRevision + 1,
      actor: '窗口B',
      status: 'open'
    });
    // 后到输入完整保留
    expect(second.conflict!.attemptedInput).toEqual({
      patch: { pendingReason: '窗口B的输入' }
    });
    // 状态中链版本仍是先到的版本
    const binding = second.state.bindings.find((b) => b.id === setup.bindingId)!;
    expect(binding.revision).toBe(baseRevision + 1);
    expect(binding.pendingReason).toBeUndefined();
  });

  it('基于最新版本重新提交可以成功', () => {
    const setup = fixture();
    const rev = setup.state.bindings[0].revision;
    const afterFirst = commit(setup.state, {
      type: 'save_binding',
      bindingId: setup.bindingId,
      expectedRevision: rev,
      actor: 'A',
      patch: {}
    });
    const retried = commit(afterFirst.state, {
      type: 'save_binding',
      bindingId: setup.bindingId,
      expectedRevision: rev + 1,
      actor: 'B',
      patch: {}
    });
    expect(retried.ok).toBe(true);
    expect(retried.conflict).toBeUndefined();
  });
});

describe('待核数据补齐重算', () => {
  it('旧数据缺标识版本时报告为待核，禁止签发；补齐后转为草稿', () => {
    const state = emptyState();
    const cert = createCertificate(state, {
      certNo: 'C-OLD',
      version: 1,
      productName: '旧泵',
      issuer: 'NMPA'
    });
    const batch = createBatch(state, {
      batchNo: 'OLD-1',
      udiId: 'UDI-PENDING',
      manufacturer: '待查',
      producedAt: '2019-01-01',
      quantity: 1
    });
    const binding = createBinding(state, {
      signalId: 'SIG-OLD',
      signalTitle: '旧数据',
      certId: cert.id,
      batchIds: [batch.id]
    });
    const report = createReport(state, {
      bindingId: binding.id,
      signalId: 'SIG-OLD',
      title: '待核报告',
      author: '迁移',
      legacy: true
    });
    expect(report.status).toBe('pending_verification');
    expect(() => commit(state, { type: 'issue_report', reportId: report.id, actor: '甲' })).toThrow(
      '待核'
    );

    const udi = createUdi(state, {
      udiCode: '069OLDUDI00001',
      productName: '旧泵',
      manufacturer: '已核实厂商',
      model: 'OLD'
    });
    const resolved = commit(state, {
      type: 'resolve_pending',
      bindingId: binding.id,
      expectedRevision: binding.revision,
      actor: '核实人',
      udiId: udi.id,
      udiRevision: 1
    });
    expect(resolved.ok).toBe(true);
    const updatedBinding = resolved.state.bindings.find((b) => b.id === binding.id)!;
    expect(updatedBinding.verificationState).toBe('verified');
    expect(updatedBinding.udiId).toBe(udi.id);
    const updatedReport = resolved.state.reports.find((r) => r.id === report.id)!;
    expect(updatedReport.status).toBe('draft');
    expect(updatedReport.legacy).toBe(false);
    // 旧批号回迁到真实标识
    expect(resolved.state.batches.find((b) => b.id === batch.id)!.udiId).toBe(udi.id);

    const issued = commit(resolved.state, {
      type: 'issue_report',
      reportId: report.id,
      actor: '甲'
    });
    expect(issued.ok).toBe(true);
    expect(issued.state.reports.find((r) => r.id === report.id)!.status).toBe('issued');
  });
});

describe('重复导入幂等', () => {
  it('相同载荷指纹第二次导入不新增数据也不新增事件', () => {
    const setup = fixture();
    const payload: TraceState = structuredClone(setup.state);
    const hash = stableHash({ v: payload });

    const apply = (s: TraceState) => structuredClone(s);
    const first = commit(setup.state, {
      type: 'import_snapshot',
      payloadHash: hash,
      actor: '导入',
      apply
    });
    const eventsAfterFirst = first.state.events.length;
    const second = commit(first.state, {
      type: 'import_snapshot',
      payloadHash: hash,
      actor: '导入',
      apply
    });
    expect(second.state.events.length).toBe(eventsAfterFirst);
    expect(second.state.importHashes).toEqual([hash]);
  });
});

describe('签发冻结', () => {
  it('签发后证据与批号变化不影响冻结依据，复议项可处理但不改原依据', () => {
    const setup = fixture();
    const after = commit(setup.state, {
      type: 'correct_batch',
      batchId: setup.batchId,
      newBatchNo: 'B-002',
      reason: '更正',
      actor: '甲'
    });
    const issued = after.state.reports.find((r) => r.id === setup.issuedId)!;
    const item = issued.reconsideration[0];
    const resolved = commit(after.state, {
      type: 'resolve_reconsideration',
      reportId: issued.id,
      itemId: item.id,
      resolution: '复核维持原结论',
      actor: '评审人'
    });
    const finalReport = resolved.state.reports.find((r) => r.id === issued.id)!;
    expect(finalReport.frozenBasis!.batches[0].batchNo).toBe('B-001');
    expect(finalReport.reconsideration[0].resolved).toBe(true);
  });

  it('已失效报告不能直接签发', () => {
    let setup = fixture();
    setup = {
      ...setup,
      state: commit(setup.state, {
        type: 'correct_batch',
        batchId: setup.batchId,
        newBatchNo: 'B-003',
        reason: 'x',
        actor: '甲'
      }).state
    };
    expect(() =>
      commit(setup.state, { type: 'issue_report', reportId: setup.draftId, actor: '甲' })
    ).toThrow('失效');
  });
});

describe('状态不可变性', () => {
  it('commit 不修改输入状态', () => {
    const setup = fixture();
    const snapshot = JSON.stringify(setup.state);
    commit(setup.state, {
      type: 'correct_udi',
      udiId: setup.udiId,
      newCode: '06900000000099',
      reason: 'r',
      actor: 'a'
    } satisfies TraceAction);
    expect(JSON.stringify(setup.state)).toBe(snapshot);
  });
});
