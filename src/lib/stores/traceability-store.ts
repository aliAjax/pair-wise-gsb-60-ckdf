import { browser } from '$app/environment';
import type {
  DeviceIdentifier,
  IdentifierConflict,
  ImportRecord,
  ProductionLot,
  RegistrationCertificate,
  ReportBasis,
  SnapshotMeta,
  StoreResult,
  TraceabilityReport,
  TraceabilitySnapshot,
  TraceabilityState,
  TraceAuditEntry
} from '$lib/models/traceability';
import { seedTraceability } from '$lib/services/traceability-seed';
import { get, writable } from 'svelte/store';

const STORAGE_KEY = 'medical-traceability-v1';
const SNAPSHOT_KEY = 'medical-traceability-snapshots-v1';
const MAX_SNAPSHOTS = 5;

function now() {
  return new Date().toISOString();
}

function makeId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`;
}

function cloneSeed(): TraceabilityState {
  return structuredClone(seedTraceability);
}

/* ---------- 迁移与完整性 ---------- */

/** 旧数据缺标识版本时进入待核；同时补齐缺失的集合字段。 */
function migrate(raw: unknown): TraceabilityState {
  const state = structuredClone(raw) as TraceabilityState;
  state.identifiers ??= [];
  state.certificates ??= [];
  state.lots ??= [];
  state.reports ??= [];
  state.audit ??= [];
  state.importedKeys ??= [];

  for (const identifier of state.identifiers) {
    identifier.lotIds ??= [];
    identifier.revisions ??= [];
    if (identifier.version == null) {
      identifier.status = 'pending_review';
    }
  }
  for (const lot of state.lots) {
    lot.splitInto ??= [];
  }
  for (const report of state.reports) {
    report.reconsiderations ??= [];
    report.evidenceIds ??= [];
    report.lotIds ??= [];
  }
  for (const cert of state.certificates) {
    cert.revisions ??= [];
  }
  return state;
}

/** 提交前的完整性校验：任何悬空引用都视为不完整状态，禁止落库。 */
function validateState(state: TraceabilityState): string[] {
  const problems: string[] = [];
  const identifierIds = new Set(state.identifiers.map((item) => item.id));
  const certIds = new Set(state.certificates.map((item) => item.id));
  const lotIds = new Set(state.lots.map((item) => item.id));

  for (const identifier of state.identifiers) {
    if (!certIds.has(identifier.certId)) {
      problems.push(`标识 ${identifier.id} 引用了不存在的注册证 ${identifier.certId}`);
    }
    for (const lotId of identifier.lotIds) {
      if (!lotIds.has(lotId)) problems.push(`标识 ${identifier.id} 引用了不存在的批号 ${lotId}`);
    }
  }
  for (const lot of state.lots) {
    if (!identifierIds.has(lot.identifierId)) {
      problems.push(`批号 ${lot.id} 引用了不存在的标识 ${lot.identifierId}`);
    }
  }
  for (const report of state.reports) {
    if (!identifierIds.has(report.identifierId)) {
      problems.push(`报告 ${report.id} 引用了不存在的标识 ${report.identifierId}`);
    }
  }
  return problems;
}

/* ---------- 快照 ---------- */

function readSnapshots(): TraceabilitySnapshot[] {
  if (!browser) return [];
  try {
    const raw = localStorage.getItem(SNAPSHOT_KEY);
    return raw ? (JSON.parse(raw) as TraceabilitySnapshot[]) : [];
  } catch {
    return [];
  }
}

function recordSnapshot(state: TraceabilityState) {
  if (!browser) return;
  try {
    const snapshots = readSnapshots();
    snapshots.unshift({ id: makeId('SNAP'), createdAt: now(), state: structuredClone(state) });
    localStorage.setItem(SNAPSHOT_KEY, JSON.stringify(snapshots.slice(0, MAX_SNAPSHOTS)));
  } catch {
    // 快照写入失败不阻断主流程，主状态已持久化
  }
}

/* ---------- 持久化与故障恢复 ---------- */

let failNextWrite = false;

function persist(state: TraceabilityState) {
  if (!browser) return;
  if (failNextWrite) {
    failNextWrite = false;
    throw new Error('模拟的存储写入失败');
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function recoveryEntry(snapshot: SnapshotMeta | null, actor: string): TraceAuditEntry {
  return {
    id: makeId('TA'),
    actor,
    action: '快照恢复',
    detail: snapshot
      ? `写入失败，已从最近完整追溯快照 ${snapshot.id}（${snapshot.createdAt.slice(0, 16).replace('T', ' ')}）恢复。`
      : '写入失败且无可用快照，已回退到初始种子数据。',
    createdAt: now()
  };
}

function restoreLatestSnapshot(actor = '系统'): SnapshotMeta | undefined {
  const snapshot = readSnapshots()[0] ?? null;
  const restored = snapshot ? migrate(snapshot.state) : cloneSeed();
  restored.audit.unshift(recoveryEntry(snapshot, actor));
  internal.set(restored);
  try {
    persist(restored);
  } catch {
    // 存储仍不可用时至少保证内存状态完整
  }
  return snapshot ? { id: snapshot.id, createdAt: snapshot.createdAt } : undefined;
}

/**
 * 统一提交入口：先校验完整性，再落库。
 * 任一步失败都从最近完整快照恢复，保证不会出现半截追溯记录。
 */
function commit(next: TraceabilityState): StoreResult {
  const problems = validateState(next);
  if (problems.length > 0) {
    const recoveredFrom = restoreLatestSnapshot();
    return { ok: false, message: `状态校验失败：${problems[0]}`, recoveredFrom };
  }
  try {
    persist(next);
  } catch {
    const recoveredFrom = restoreLatestSnapshot();
    return { ok: false, message: '写入存储失败，已从最近完整追溯快照恢复。', recoveredFrom };
  }
  internal.set(next);
  recordSnapshot(next);
  return { ok: true };
}

/* ---------- 初始化 ---------- */

function loadInitial(): TraceabilityState {
  if (!browser) return cloneSeed();
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      const parsed = migrate(JSON.parse(raw));
      if (validateState(parsed).length === 0) return parsed;
    } catch {
      // 落库数据损坏，走快照恢复
    }
    const snapshot = readSnapshots()[0] ?? null;
    if (snapshot) {
      const restored = migrate(snapshot.state);
      restored.audit.unshift(recoveryEntry({ id: snapshot.id, createdAt: snapshot.createdAt }, '系统'));
      return restored;
    }
  }
  return cloneSeed();
}

const internal = writable<TraceabilityState>(loadInitial());

// 跨窗口同步：另一个窗口提交后，本窗口立即看到最新版本，从而触发并发冲突检测
if (browser) {
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY && event.newValue) {
      try {
        const parsed = migrate(JSON.parse(event.newValue));
        if (validateState(parsed).length === 0) internal.set(parsed);
      } catch {
        // 忽略无法解析的广播
      }
    }
  });
}

/* ---------- 派生工具 ---------- */

function audit(state: TraceabilityState, actor: string, action: string, detail: string) {
  state.audit.unshift({ id: makeId('TA'), actor, action, detail, createdAt: now() });
}

function findIdentifier(state: TraceabilityState, id: string) {
  return state.identifiers.find((item) => item.id === id) ?? null;
}

function captureBasis(state: TraceabilityState, identifier: DeviceIdentifier, lotIds: string[]): ReportBasis | null {
  const cert = state.certificates.find((item) => item.id === identifier.certId);
  if (!cert) return null;
  const lots = lotIds
    .map((lotId) => state.lots.find((item) => item.id === lotId))
    .filter((item): item is ProductionLot => Boolean(item))
    .map((item) => ({ lotId: item.id, lotNumber: item.lotNumber, version: item.version, status: item.status }));
  return {
    identifierId: identifier.id,
    identifierUdi: identifier.udi,
    identifierVersion: identifier.version,
    certId: cert.id,
    certNumber: cert.certNumber,
    certVersion: cert.version,
    lots,
    capturedAt: now()
  };
}

function summarizeBasis(basis: ReportBasis): string {
  const identifierPart = `标识 V${basis.identifierVersion ?? '待核'}`;
  const certPart = `注册证 V${basis.certVersion}`;
  const lotPart = basis.lots.map((lot) => `${lot.lotNumber} V${lot.version}`).join('、') || '无批号';
  return `${identifierPart} / ${certPart} / ${lotPart}`;
}

/** 计算报告依据快照与当前状态的差异，返回可读的差异描述。 */
function diffBasis(state: TraceabilityState, report: TraceabilityReport): string[] {
  const diffs: string[] = [];
  const identifier = findIdentifier(state, report.identifierId);
  if (!identifier) return ['关联标识已不存在'];

  if (report.basis.identifierVersion !== identifier.version) {
    diffs.push(`器械标识 V${report.basis.identifierVersion ?? '待核'} -> V${identifier.version ?? '待核'}`);
  }
  const cert = state.certificates.find((item) => item.id === identifier.certId);
  if (cert && report.basis.certVersion !== cert.version) {
    diffs.push(`注册证 V${report.basis.certVersion} -> V${cert.version}`);
  }
  for (const basisLot of report.basis.lots) {
    const current = state.lots.find((item) => item.id === basisLot.lotId);
    if (!current) {
      diffs.push(`批号 ${basisLot.lotNumber} 已移除`);
    } else if (current.version !== basisLot.version || current.status !== basisLot.status) {
      if (current.status === 'split') {
        const targets = current.splitInto
          .map((lotId) => state.lots.find((item) => item.id === lotId)?.lotNumber)
          .filter(Boolean)
          .join('、');
        diffs.push(`批号 ${basisLot.lotNumber} 已拆分为 ${targets || '新批号'}`);
      } else {
        diffs.push(`批号 ${basisLot.lotNumber} V${basisLot.version} -> V${current.version}`);
      }
    }
  }
  return diffs;
}

/**
 * 变更联动核心：标识、批号或注册证变化后，
 * 未签发报告立即失效；已签发报告保留原依据并追加复议项。
 */
function reconcileReports(state: TraceabilityState, identifierId: string, changeDescription: string) {
  const result = { invalidated: 0, reconsidered: 0 };
  for (const report of state.reports) {
    if (report.identifierId !== identifierId) continue;
    if (report.status === 'invalidated') continue;
    const diffs = diffBasis(state, report);
    if (diffs.length === 0) continue;

    if (report.status === 'draft') {
      report.status = 'invalidated';
      report.invalidatedAt = now();
      report.invalidationReason = `${changeDescription}；${diffs.join('；')}`;
      result.invalidated += 1;
      audit(state, '系统', '报告失效', `${report.id} 因${changeDescription}失效：${diffs.join('；')}`);
    } else if (report.status === 'issued') {
      report.reconsiderations.unshift({
        id: makeId('RC'),
        reason: changeDescription,
        before: summarizeBasis(report.basis),
        after: diffs.join('；'),
        createdAt: now(),
        status: 'open'
      });
      result.reconsidered += 1;
      audit(state, '系统', '新增复议项', `${report.id} 已签发，保留原依据，新增复议项：${changeDescription}。`);
    }
  }
  return result;
}

/* ---------- Store ---------- */

export const traceabilityStore = {
  subscribe: internal.subscribe,

  /** 生产商更正标识：乐观并发控制，先到的版本生效，后到者保留输入并提示冲突。 */
  correctIdentifier(input: {
    id: string;
    baseVersion: number;
    udi: string;
    productName: string;
    manufacturer: string;
    reason: string;
    actor: string;
  }): StoreResult {
    const state = structuredClone(get(internal));
    const identifier = findIdentifier(state, input.id);
    if (!identifier) return { ok: false, message: '未找到该器械标识。' };
    if (identifier.status === 'pending_review') {
      return { ok: false, message: '该标识处于待核状态，请先补齐版本。' };
    }
    if (identifier.version !== input.baseVersion) {
      const conflict: IdentifierConflict = {
        identifierId: identifier.id,
        attemptedBaseVersion: input.baseVersion,
        currentVersion: identifier.version ?? 0,
        current: {
          udi: identifier.udi,
          productName: identifier.productName,
          manufacturer: identifier.manufacturer,
          updatedAt: identifier.updatedAt,
          lastActor: identifier.revisions[identifier.revisions.length - 1]?.actor ?? '未知'
        }
      };
      audit(
        state,
        input.actor,
        '并发冲突',
        `基于 V${input.baseVersion} 的更正被拒绝，当前生效版本为 V${identifier.version}，输入已保留待处理。`
      );
      commit(state);
      return { ok: false, message: '该标识已被其他窗口更新，您的修改未生效。', conflict };
    }

    const previousVersion = identifier.version ?? 0;
    identifier.udi = input.udi;
    identifier.productName = input.productName;
    identifier.manufacturer = input.manufacturer;
    identifier.version = previousVersion + 1;
    identifier.updatedAt = now();
    identifier.revisions.push({
      version: identifier.version,
      udi: input.udi,
      productName: input.productName,
      manufacturer: input.manufacturer,
      changedAt: now(),
      reason: input.reason,
      actor: input.actor
    });
    audit(state, input.actor, '标识更正', `${identifier.id} 标识 V${previousVersion} -> V${identifier.version}：${input.reason}`);
    const outcome = reconcileReports(state, identifier.id, `标识更正为 V${identifier.version}`);
    if (outcome.invalidated + outcome.reconsidered > 0) {
      audit(state, '系统', '重算完成', `标识更正联动：${outcome.invalidated} 份未签发报告失效，${outcome.reconsidered} 份已签发报告新增复议项。`);
    }
    const result = commit(state);
    if (result.ok) return { ok: true, message: `标识已更正为 V${identifier.version}。` };
    return result;
  },

  /** 拆分批号：原批号标记为已拆分，新批号挂到同一标识下。 */
  splitLot(input: { lotId: string; newLotNumbers: string[]; reason: string; actor: string }): StoreResult {
    const state = structuredClone(get(internal));
    const lot = state.lots.find((item) => item.id === input.lotId);
    if (!lot) return { ok: false, message: '未找到该生产批号。' };
    if (lot.status !== 'active') return { ok: false, message: '该批号已拆分，不能重复拆分。' };
    const identifier = findIdentifier(state, lot.identifierId);
    if (!identifier) return { ok: false, message: '批号关联的标识不存在。' };

    const newLots: ProductionLot[] = input.newLotNumbers.map((lotNumber) => ({
      id: makeId('LOT'),
      identifierId: identifier.id,
      lotNumber,
      version: 1,
      status: 'active',
      manufacturedAt: lot.manufacturedAt,
      quantity: 0,
      splitInto: [],
      note: `拆分自 ${lot.lotNumber}`
    }));
    lot.status = 'split';
    lot.version += 1;
    lot.splitInto = newLots.map((item) => item.id);
    state.lots.push(...newLots);
    identifier.lotIds.push(...newLots.map((item) => item.id));
    identifier.updatedAt = now();

    audit(
      state,
      input.actor,
      '批号拆分',
      `批号 ${lot.lotNumber} 拆分为 ${input.newLotNumbers.join('、')}：${input.reason}`
    );
    const outcome = reconcileReports(state, identifier.id, `批号 ${lot.lotNumber} 拆分`);
    if (outcome.invalidated + outcome.reconsidered > 0) {
      audit(state, '系统', '重算完成', `批号拆分联动：${outcome.invalidated} 份未签发报告失效，${outcome.reconsidered} 份已签发报告新增复议项。`);
    }
    const result = commit(state);
    if (result.ok) return { ok: true, message: `批号 ${lot.lotNumber} 已拆分。` };
    return result;
  },

  /** 注册证换版：版本号递增，联动所有引用该注册证的标识。 */
  renewCertificate(input: {
    certId: string;
    certNumber: string;
    validUntil: string;
    reason: string;
    actor: string;
  }): StoreResult {
    const state = structuredClone(get(internal));
    const cert = state.certificates.find((item) => item.id === input.certId);
    if (!cert) return { ok: false, message: '未找到该注册证。' };

    const previousVersion = cert.version;
    cert.version += 1;
    cert.certNumber = input.certNumber;
    cert.validUntil = input.validUntil;
    cert.revisions.push({
      version: cert.version,
      certNumber: input.certNumber,
      validUntil: input.validUntil,
      changedAt: now(),
      reason: input.reason,
      actor: input.actor
    });
    audit(state, input.actor, '注册证换版', `${cert.id} 注册证 V${previousVersion} -> V${cert.version}：${input.reason}`);

    let invalidated = 0;
    let reconsidered = 0;
    for (const identifier of state.identifiers.filter((item) => item.certId === cert.id)) {
      const outcome = reconcileReports(state, identifier.id, `注册证换版为 V${cert.version}`);
      invalidated += outcome.invalidated;
      reconsidered += outcome.reconsidered;
    }
    if (invalidated + reconsidered > 0) {
      audit(state, '系统', '重算完成', `注册证换版联动：${invalidated} 份未签发报告失效，${reconsidered} 份已签发报告新增复议项。`);
    }
    const result = commit(state);
    if (result.ok) return { ok: true, message: `注册证已换版为 V${cert.version}。` };
    return result;
  },

  /** 签发报告：冻结当前追溯依据作为原依据。 */
  issueReport(reportId: string, actor: string): StoreResult {
    const state = structuredClone(get(internal));
    const report = state.reports.find((item) => item.id === reportId);
    if (!report) return { ok: false, message: '未找到该报告。' };
    if (report.status !== 'draft') return { ok: false, message: '仅未签发的报告可以签发。' };
    const identifier = findIdentifier(state, report.identifierId);
    if (!identifier) return { ok: false, message: '报告关联的标识不存在。' };
    if (identifier.status === 'pending_review') {
      return { ok: false, message: '关联标识处于待核状态，补齐版本后才能签发。' };
    }
    const basis = captureBasis(state, identifier, report.lotIds);
    if (!basis) return { ok: false, message: '无法生成追溯依据快照。' };

    report.basis = basis;
    report.status = 'issued';
    report.issuedAt = now();
    audit(state, actor, '报告签发', `${report.id} 依据${summarizeBasis(basis)}签发。`);
    const result = commit(state);
    if (result.ok) return { ok: true, message: `${report.id} 已签发，依据快照已冻结。` };
    return result;
  },

  /** 确认已签发报告上的复议项。 */
  acknowledgeReconsideration(reportId: string, itemId: string, actor: string): StoreResult {
    const state = structuredClone(get(internal));
    const report = state.reports.find((item) => item.id === reportId);
    const item = report?.reconsiderations.find((entry) => entry.id === itemId);
    if (!report || !item) return { ok: false, message: '未找到该复议项。' };
    if (item.status === 'acknowledged') return { ok: false, message: '该复议项已确认。' };
    item.status = 'acknowledged';
    audit(state, actor, '复议项确认', `${report.id} 复议项「${item.reason}」已确认。`);
    return commit(state);
  },

  /** 建立追溯报告（草稿）：把标识、注册证、批号和信号证据链接成一份记录。 */
  createReport(input: {
    title: string;
    identifierId: string;
    signalId?: string;
    evidenceIds?: string[];
    actor: string;
  }): StoreResult {
    const state = structuredClone(get(internal));
    const identifier = findIdentifier(state, input.identifierId);
    if (!identifier) return { ok: false, message: '请选择有效的器械标识。' };
    const lotIds = identifier.lotIds.filter((lotId) =>
      state.lots.some((lot) => lot.id === lotId && lot.status === 'active')
    );
    const basis = captureBasis(state, identifier, lotIds);
    if (!basis) return { ok: false, message: '无法生成追溯依据快照。' };

    const report: TraceabilityReport = {
      id: `RPT-${new Date().getFullYear()}-${String(state.reports.length + 42).padStart(4, '0')}`,
      title: input.title,
      signalId: input.signalId || null,
      evidenceIds: input.evidenceIds ?? [],
      identifierId: identifier.id,
      lotIds,
      status: 'draft',
      basis,
      issuedAt: null,
      invalidatedAt: null,
      invalidationReason: null,
      reconsiderations: [],
      createdAt: now()
    };
    state.reports.unshift(report);
    audit(state, input.actor, '建立追溯报告', `${report.id} 基于${summarizeBasis(basis)}建立，关联 ${report.evidenceIds.length} 项信号证据。`);
    const result = commit(state);
    if (result.ok) return { ok: true, message: `${report.id} 已建立（未签发）。` };
    return result;
  },

  /** 幂等导入：按 importKey 去重，重复导入不新增审计。 */
  importRecords(records: ImportRecord[], actor: string): StoreResult & { added: number; duplicates: number; rejected: number } {
    const state = structuredClone(get(internal));
    let added = 0;
    let duplicates = 0;
    let rejected = 0;

    for (const record of records) {
      if (state.importedKeys.includes(record.importKey)) {
        duplicates += 1;
        continue;
      }
      const identifier = state.identifiers.find((item) => item.udi === record.udi);
      if (!identifier) {
        rejected += 1;
        continue;
      }
      const lot: ProductionLot = {
        id: makeId('LOT'),
        identifierId: identifier.id,
        lotNumber: record.lotNumber,
        version: 1,
        status: 'active',
        manufacturedAt: record.manufacturedAt,
        quantity: record.quantity,
        splitInto: [],
        note: `导入批次 ${record.importKey}`
      };
      state.lots.push(lot);
      identifier.lotIds.push(lot.id);
      identifier.updatedAt = now();
      state.importedKeys.push(record.importKey);
      added += 1;
    }

    if (added > 0) {
      audit(
        state,
        actor,
        '导入追溯记录',
        `导入 ${added} 条新批号记录，跳过 ${duplicates} 条重复、${rejected} 条未匹配标识。`
      );
    }
    const result = commit(state);
    if (!result.ok) return { ...result, added: 0, duplicates: 0, rejected: 0 };
    return {
      ok: true,
      added,
      duplicates,
      rejected,
      message:
        added > 0
          ? `导入完成：新增 ${added} 条，重复跳过 ${duplicates} 条，未匹配 ${rejected} 条。`
          : `全部为重复或未匹配记录（重复 ${duplicates} 条、未匹配 ${rejected} 条），未新增审计。`
    };
  },

  /** 待核补齐：补录标识版本，解除待核并重算相关报告。 */
  completeReview(input: { id: string; version: number; note: string; actor: string }): StoreResult {
    const state = structuredClone(get(internal));
    const identifier = findIdentifier(state, input.id);
    if (!identifier) return { ok: false, message: '未找到该器械标识。' };
    if (identifier.status !== 'pending_review') {
      return { ok: false, message: '该标识不在待核状态。' };
    }

    identifier.version = input.version;
    identifier.status = 'active';
    identifier.updatedAt = now();
    identifier.revisions.push({
      version: input.version,
      udi: identifier.udi,
      productName: identifier.productName,
      manufacturer: identifier.manufacturer,
      changedAt: now(),
      reason: `待核补齐：${input.note}`,
      actor: input.actor
    });
    audit(state, input.actor, '待核补齐', `${identifier.id} 标识版本补齐为 V${input.version}：${input.note}`);

    const outcome = reconcileReports(state, identifier.id, `标识版本补齐为 V${input.version}`);
    audit(
      state,
      '系统',
      '重算完成',
      `待核补齐后重算：${outcome.invalidated} 份未签发报告失效，${outcome.reconsidered} 份已签发报告新增复议项。`
    );
    const result = commit(state);
    if (result.ok) return { ok: true, message: `标识已补齐为 V${input.version} 并完成重算。` };
    return result;
  },

  /** 手动从指定快照恢复。 */
  restoreSnapshot(snapshotId: string, actor: string): StoreResult {
    const snapshot = readSnapshots().find((item) => item.id === snapshotId);
    if (!snapshot) return { ok: false, message: '未找到该快照。' };
    const restored = migrate(snapshot.state);
    audit(
      restored,
      actor,
      '快照恢复',
      `人工从快照 ${snapshot.id}（${snapshot.createdAt.slice(0, 16).replace('T', ' ')}）恢复。`
    );
    return commit(restored);
  },

  /** 故障演练：让下一次写入失败，验证快照恢复链路。 */
  armWriteFailure() {
    failNextWrite = true;
  },

  listSnapshots(): SnapshotMeta[] {
    return readSnapshots().map(({ id, createdAt }) => ({ id, createdAt }));
  },

  validateCurrent(): string[] {
    return validateState(get(internal));
  },

  reset() {
    failNextWrite = false;
    const fresh = cloneSeed();
    internal.set(fresh);
    if (browser) {
      try {
        persist(fresh);
        localStorage.removeItem(SNAPSHOT_KEY);
        recordSnapshot(fresh);
      } catch {
        // 重置失败时保持内存状态
      }
    }
  },

  getSnapshot(): TraceabilityState {
    return get(internal);
  }
};
