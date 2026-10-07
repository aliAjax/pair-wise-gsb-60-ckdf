/**
 * 追溯台账种子数据：
 * - SIG-2026-018：报告已签发，之后注册证换版 + 批号拆分 -> 冻结原依据并列两条复议项；
 * - SIG-2026-015：草稿期间批号被生产商更正 -> 未签发报告立即失效；
 * - SIG-2026-011：已签发后依据未再变化；
 * - SIG-2026-019：依据齐全的未签发草稿，可直接演示签发；
 * - SIG-2025-LEG-02：旧数据迁移，缺标识版本 -> 待核，补齐后重算。
 */
import {
  commit,
  createBatch,
  createBinding,
  createCertificate,
  createReport,
  createUdi,
  emptyState,
  stableHash
} from './engine';
import type { TraceBinding, TraceEvidenceRef, TraceState } from './types';

function bindEvidence(
  state: TraceState,
  binding: TraceBinding,
  input: Omit<TraceEvidenceRef, 'id' | 'boundAt' | 'contentHash'> & { boundAt?: string }
): void {
  state.seq += 1;
  binding.evidence.push({
    ...input,
    id: `EV-${state.seq}`,
    boundAt: input.boundAt ?? new Date().toISOString(),
    contentHash: stableHash({
      title: input.title,
      source: input.source,
      note: input.note,
      strength: input.strength
    })
  });
}

export function buildSeedTrace(): TraceState {
  let state = emptyState();

  // ── SIG-2026-018 智能输液泵 IP-800 ──────────────────────────────
  const udi18 = createUdi(state, {
    udiCode: '06901234000181',
    productName: '智能输液泵 IP-800',
    manufacturer: '华东医械制造有限公司',
    model: 'IP-800'
  });
  const cert18 = createCertificate(state, {
    certNo: '国械注准20243188',
    version: 2,
    productName: '智能输液泵 IP-800',
    issuer: '国家药品监督管理局',
    issuedAt: '2025-11-02T00:00:00.000Z'
  });
  const b18a = createBatch(state, {
    batchNo: 'IP8-260401',
    udiId: udi18.id,
    manufacturer: udi18.manufacturer,
    producedAt: '2026-04-01',
    quantity: 1200
  });
  const b18b = createBatch(state, {
    batchNo: 'IP8-260403',
    udiId: udi18.id,
    manufacturer: udi18.manufacturer,
    producedAt: '2026-04-03',
    quantity: 848
  });
  const bind18 = createBinding(state, {
    signalId: 'SIG-2026-018',
    signalTitle: '输注泵阻塞报警集中发生于同一批管路',
    udiId: udi18.id,
    certId: cert18.id,
    batchIds: [b18a.id, b18b.id]
  });
  bindEvidence(state, bind18, {
    signalId: 'SIG-2026-018',
    title: '华东区域 11 起同类投诉',
    source: '客服工单系统',
    evidenceType: 'complaint',
    strength: 'strong',
    batchId: b18a.id,
    batchNoAtBinding: 'IP8-260401',
    note: '报警发生时间集中在装机后第 7 至 14 天。',
    boundAt: '2026-09-09T02:30:00.000Z'
  });
  bindEvidence(state, bind18, {
    signalId: 'SIG-2026-018',
    title: '压力传感器零点漂移记录',
    source: '维修记录 R-9081',
    evidenceType: 'repair',
    strength: 'moderate',
    batchId: b18a.id,
    batchNoAtBinding: 'IP8-260401',
    note: '更换传感器后 3 台设备未复现，不能排除装配扭矩影响。',
    boundAt: '2026-09-14T06:20:00.000Z'
  });
  bindEvidence(state, bind18, {
    signalId: 'SIG-2026-018',
    title: '留样压力曲线对比',
    source: '可靠性实验室',
    evidenceType: 'test',
    strength: 'contrary',
    batchId: b18b.id,
    batchNoAtBinding: 'IP8-260403',
    note: '留样在标准测试条件下未出现同类波动，需补充现场使用条件。',
    boundAt: '2026-09-24T09:15:00.000Z'
  });
  const rpt18 = createReport(state, {
    bindingId: bind18.id,
    signalId: 'SIG-2026-018',
    title: '输注泵阻塞报警信号核查审计报告',
    author: '周宁'
  });
  state = commit(state, { type: 'issue_report', reportId: rpt18.id, actor: '周宁' }).state;
  // 签发之后：注册证换版
  state = commit(state, {
    type: 'revise_certificate',
    certId: cert18.id,
    newVersion: 3,
    reason: '注册证载明的适用范围与附件组成更正换版。',
    actor: '注册专员 李禾'
  }).state;
  // 签发之后：生产商对问题批号实施拆分追溯
  state = commit(state, {
    type: 'split_batch',
    batchId: b18a.id,
    parts: [
      { batchNo: 'IP8-260401-A', producedAt: '2026-04-01', quantity: 600, note: '管路供应商批次 SUP-A' },
      { batchNo: 'IP8-260401-B', producedAt: '2026-04-01', quantity: 600, note: '管路供应商批次 SUP-B' }
    ],
    actor: '生产质量部 陈明'
  }).state;

  // ── SIG-2026-015 多参数监护仪 M12（草稿失效） ───────────────────
  const udi15 = createUdi(state, {
    udiCode: '06901234000150',
    productName: '多参数监护仪 M12',
    manufacturer: '南岭电子医疗股份公司',
    model: 'M12'
  });
  const cert15 = createCertificate(state, {
    certNo: '国械注准20232151',
    version: 1,
    productName: '多参数监护仪 M12',
    issuer: '国家药品监督管理局',
    issuedAt: '2023-12-10T00:00:00.000Z'
  });
  const b15 = createBatch(state, {
    batchNo: 'M12-251118',
    udiId: udi15.id,
    manufacturer: udi15.manufacturer,
    producedAt: '2025-11-18',
    quantity: 876
  });
  const bind15 = createBinding(state, {
    signalId: 'SIG-2026-015',
    signalTitle: '监护仪电池续航低于标称值',
    udiId: udi15.id,
    certId: cert15.id,
    batchIds: [b15.id]
  });
  bindEvidence(state, bind15, {
    signalId: 'SIG-2026-015',
    title: '电池容量测试记录',
    source: '区域维修中心',
    evidenceType: 'repair',
    strength: 'strong',
    batchId: b15.id,
    batchNoAtBinding: 'M12-251118',
    note: '6 台设备容量均低于出厂规格下限。',
    boundAt: '2026-08-25T03:10:00.000Z'
  });
  bindEvidence(state, bind15, {
    signalId: 'SIG-2026-015',
    title: '充电柜批次核查',
    source: '现场服务报告 F-771',
    evidenceType: 'field_report',
    strength: 'weak',
    batchId: b15.id,
    batchNoAtBinding: 'M12-251118',
    note: '两家医院使用相同型号充电柜，使用条件尚不一致。',
    boundAt: '2026-09-02T07:20:00.000Z'
  });
  const rpt15 = createReport(state, {
    bindingId: bind15.id,
    signalId: 'SIG-2026-015',
    title: '监护仪电池续航信号审计报告（草稿）',
    author: '林澈'
  });
  // 生产商反馈批号喷码错误并更正 -> 未签发草稿立即失效
  state = commit(state, {
    type: 'correct_batch',
    batchId: b15.id,
    newBatchNo: 'M12-251118R',
    reason: '生产商确认喷码机日期戳错位，批号本体更正。',
    actor: '生产质量部 何帆'
  }).state;
  void rpt15;

  // ── SIG-2026-011 影像工作站（已签发、依据稳定） ─────────────────
  const udi11 = createUdi(state, {
    udiCode: '06901234000112',
    productName: '影像工作站 WS-5',
    manufacturer: '启澜软件医疗有限公司',
    model: 'WS-5'
  });
  const cert11 = createCertificate(state, {
    certNo: '国械注准20222217',
    version: 4,
    productName: '影像工作站 WS-5',
    issuer: '国家药品监督管理局',
    issuedAt: '2026-03-15T00:00:00.000Z'
  });
  const b11 = createBatch(state, {
    batchNo: 'SW-5.3.1',
    udiId: udi11.id,
    manufacturer: udi11.manufacturer,
    producedAt: '2026-05-20',
    quantity: 310
  });
  const bind11 = createBinding(state, {
    signalId: 'SIG-2026-011',
    signalTitle: '影像工作站测量工具结果偶发偏差',
    udiId: udi11.id,
    certId: cert11.id,
    batchIds: [b11.id]
  });
  bindEvidence(state, bind11, {
    signalId: 'SIG-2026-011',
    title: '5.3.2 修复版本回归报告',
    source: '软件测试报告 TR-4402',
    evidenceType: 'test',
    strength: 'strong',
    batchId: b11.id,
    batchNoAtBinding: 'SW-5.3.1',
    note: '连续执行 500 次缩放切换未复现。',
    boundAt: '2026-08-10T02:00:00.000Z'
  });
  const rpt11 = createReport(state, {
    bindingId: bind11.id,
    signalId: 'SIG-2026-011',
    title: '影像工作站测量偏差信号审计报告',
    author: '高远'
  });
  state = commit(state, { type: 'issue_report', reportId: rpt11.id, actor: '高远' }).state;

  // ── SIG-2026-019 除颤器 D9（依据齐全的待签发草稿） ──────────────
  const udi19 = createUdi(state, {
    udiCode: '06901234000198',
    productName: '双相波除颤器 D9',
    manufacturer: '华东医械制造有限公司',
    model: 'D9'
  });
  const cert19 = createCertificate(state, {
    certNo: '国械注准20213109',
    version: 5,
    productName: '双相波除颤器 D9',
    issuer: '国家药品监督管理局',
    issuedAt: '2026-01-20T00:00:00.000Z'
  });
  const b19 = createBatch(state, {
    batchNo: 'D9-260722',
    udiId: udi19.id,
    manufacturer: udi19.manufacturer,
    producedAt: '2026-07-22',
    quantity: 120
  });
  const bind19 = createBinding(state, {
    signalId: 'SIG-2026-019',
    signalTitle: '除颤器充电过程温升异常',
    udiId: udi19.id,
    certId: cert19.id,
    batchIds: [b19.id]
  });
  bindEvidence(state, bind19, {
    signalId: 'SIG-2026-019',
    title: '过温保护触发事件报告',
    source: '不良事件报告 AE-260921',
    evidenceType: 'adverse_event',
    strength: 'strong',
    batchId: b19.id,
    batchNoAtBinding: 'D9-260722',
    note: '设备未造成人员伤害，但备用电池无法完成充电。',
    boundAt: '2026-09-22T00:30:00.000Z'
  });
  bindEvidence(state, bind19, {
    signalId: 'SIG-2026-019',
    title: '首批拆机与热成像记录',
    source: '质量实验室',
    evidenceType: 'test',
    strength: 'strong',
    batchId: b19.id,
    batchNoAtBinding: 'D9-260722',
    note: '两套模组焊点阻抗偏高，温度高于控制上限。',
    boundAt: '2026-09-27T08:00:00.000Z'
  });
  createReport(state, {
    bindingId: bind19.id,
    signalId: 'SIG-2026-019',
    title: '除颤器温升异常信号审计报告（草稿）',
    author: '顾岚'
  });

  // ── 旧数据迁移：缺标识版本，进入待核 ───────────────────────────
  const certLegacy = createCertificate(state, {
    certNo: '国械注准20193766',
    version: 1,
    productName: '老式注射泵 SP-2（迁移记录）',
    issuer: '国家药品监督管理局',
    issuedAt: '2019-05-11T00:00:00.000Z'
  });
  const bLegacy = createBatch(state, {
    batchNo: 'SP2-190901',
    udiId: 'UDI-PENDING',
    manufacturer: '历史台账（生产商待确认）',
    producedAt: '2019-09-01',
    quantity: 50
  });
  const bindLegacy = createBinding(state, {
    signalId: 'SIG-2025-LEG-02',
    signalTitle: '历史注射泵流速偏差投诉（旧系统迁移）',
    certId: certLegacy.id,
    batchIds: [bLegacy.id],
    verificationState: 'pending',
    pendingReason: '旧数据仅有产品名称与批号，缺少 UDI-DI 及标识版本，需向生产商核实补齐'
  });
  bindEvidence(state, bindLegacy, {
    signalId: 'SIG-2025-LEG-02',
    title: '历史投诉单扫描件 C-2019-1142',
    source: '旧投诉系统迁移',
    evidenceType: 'complaint',
    strength: 'weak',
    batchId: bLegacy.id,
    batchNoAtBinding: 'SP2-190901',
    note: '迁移数据未记录器械标识版本，证据指纹照留，待补齐标识后重算依据。',
    boundAt: '2025-12-01T08:00:00.000Z'
  });
  createReport(state, {
    bindingId: bindLegacy.id,
    signalId: 'SIG-2025-LEG-02',
    title: '历史投诉追溯报告（待核）',
    author: '迁移程序',
    legacy: true
  });

  return state;
}
