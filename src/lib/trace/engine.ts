/**
 * 追溯引擎：所有状态变更都是纯函数 commit(state, action)，
 * 便于从快照恢复、重放与单元测试。
 */
import type {
  AuditReport,
  BasisChangeKind,
  CommitResult,
  DeviceUdi,
  EditConflict,
  FrozenBasis,
  ProductionBatch,
  RegistrationCertificate,
  TraceBinding,
  TraceEvidenceRef,
  TraceEvent,
  TraceState
} from './types';

export type TraceAction =
  | { type: 'correct_udi'; udiId: string; newCode: string; reason: string; actor: string }
  | {
      type: 'revise_certificate';
      certId: string;
      newVersion: number;
      reason: string;
      actor: string;
    }
  | {
      type: 'correct_batch';
      batchId: string;
      newBatchNo: string;
      reason: string;
      actor: string;
    }
  | {
      type: 'split_batch';
      batchId: string;
      parts: Array<{ batchNo: string; producedAt: string; quantity: number; note?: string }>;
      actor: string;
    }
  | {
      type: 'save_binding';
      bindingId: string;
      expectedRevision: number;
      actor: string;
      patch: Partial<Pick<TraceBinding, 'certId' | 'batchIds' | 'udiId' | 'pendingReason'>>;
    }
  | {
      type: 'add_evidence';
      bindingId: string;
      expectedRevision: number;
      actor: string;
      evidence: Omit<TraceEvidenceRef, 'id' | 'boundAt' | 'contentHash' | 'batchNoAtBinding'> & {
        batchNoAtBinding?: string;
      };
    }
  | {
      type: 'resolve_pending';
      bindingId: string;
      expectedRevision: number;
      actor: string;
      udiId: string;
      udiRevision: number;
    }
  | {
      type: 'register_udi';
      udiCode: string;
      productName: string;
      manufacturer: string;
      model: string;
      actor: string;
    }
  | { type: 'create_report'; bindingId: string; title: string; author: string }
  | { type: 'issue_report'; reportId: string; actor: string }
  | {
      type: 'resolve_reconsideration';
      reportId: string;
      itemId: string;
      resolution: string;
      actor: string;
    }
  | {
      type: 'resolve_conflict';
      conflictId: string;
      resolution: 'kept_first' | 'retried_with_latest' | 'discarded';
      actor: string;
    }
  | {
      type: 'import_snapshot';
      payloadHash: string;
      actor: string;
      apply: (state: TraceState) => TraceState;
    }
  | { type: 'note_recovery'; actor: string; detail: string };

export function emptyState(): TraceState {
  return {
    certificates: [],
    udis: [],
    batches: [],
    bindings: [],
    reports: [],
    events: [],
    conflicts: [],
    importHashes: [],
    seq: 0
  };
}

function nextId(state: TraceState, prefix: string): string {
  state.seq += 1;
  return `${prefix}-${state.seq}-${Math.random().toString(36).slice(2, 8)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** 稳定 JSON 指纹：重复导入据此判重，证据内容据此比对 */
export function stableHash(value: unknown): string {
  const json = JSON.stringify(sortKeys(value));
  let h = 5381;
  for (let i = 0; i < json.length; i += 1) {
    h = ((h << 5) + h + json.charCodeAt(i)) | 0;
  }
  return `h${(h >>> 0).toString(16)}${json.length.toString(16)}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, sortKeys((value as Record<string, unknown>)[key])])
    );
  }
  return value;
}

function addEvent(state: TraceState, event: Omit<TraceEvent, 'id' | 'createdAt'>): TraceEvent {
  const full: TraceEvent = { ...event, id: nextId(state, 'EVT'), createdAt: nowIso() };
  state.events.unshift(full);
  return full;
}

export function findUdi(state: TraceState, id: string): DeviceUdi | undefined {
  return state.udis.find((item) => item.id === id);
}

export function findCert(state: TraceState, id: string): RegistrationCertificate | undefined {
  return state.certificates.find((item) => item.id === id);
}

export function findBatch(state: TraceState, id: string): ProductionBatch | undefined {
  return state.batches.find((item) => item.id === id);
}

function bindingsForBatch(state: TraceState, batchId: string): TraceBinding[] {
  return state.bindings.filter((binding) => binding.batchIds.includes(batchId));
}

function bindingsForUdi(state: TraceState, udiId: string): TraceBinding[] {
  return state.bindings.filter((binding) => binding.udiId === udiId);
}

function bindingsForCert(state: TraceState, certId: string): TraceBinding[] {
  return state.bindings.filter((binding) => binding.certId === certId);
}

function labelOfKind(kind: BasisChangeKind): string {
  switch (kind) {
    case 'udi_corrected':
      return '标识更正';
    case 'cert_revised':
      return '注册证换版';
    case 'batch_corrected':
      return '批号更正';
    case 'batch_split':
      return '批号拆分';
  }
}

/**
 * 依据变更的核心传播规则：
 * 未签发（草稿）报告 -> 立即失效；
 * 已签发报告       -> 冻结依据不动，追加复议项；
 * 待核报告         -> 保持待核并追加说明。
 */
function propagateBasisChange(
  state: TraceState,
  binding: TraceBinding,
  kind: BasisChangeKind,
  detail: string
): void {
  for (const report of state.reports.filter((item) => item.bindingId === binding.id)) {
    if (report.status === 'draft') {
      report.status = 'invalidated';
      report.invalidatedAt = nowIso();
      report.invalidReason = `${labelOfKind(kind)}：${detail}`;
      report.updatedAt = nowIso();
      addEvent(state, {
        actor: '追溯引擎',
        action: '未签发报告失效',
        detail: `${report.id} 因${labelOfKind(kind)}立即失效（${detail}）。`,
        reportId: report.id,
        bindingId: binding.id,
        signalId: binding.signalId
      });
    } else if (report.status === 'issued') {
      const exists = report.reconsideration.some(
        (item) => item.kind === kind && item.detail === detail && !item.resolved
      );
      if (!exists) {
        report.reconsideration.push({
          id: nextId(state, 'REC'),
          kind,
          detail,
          detectedAt: nowIso(),
          resolved: false
        });
        report.updatedAt = nowIso();
        addEvent(state, {
          actor: '追溯引擎',
          action: '已签发报告登记复议项',
          detail: `${report.id} 原依据保留，新增${labelOfKind(kind)}复议项：${detail}`,
          reportId: report.id,
          bindingId: binding.id,
          signalId: binding.signalId
        });
      }
    }
    // pending_verification / invalidated 无需重复处理
  }
}

function freezeBasis(state: TraceState, binding: TraceBinding): FrozenBasis {
  const udi = findUdi(state, binding.udiId);
  const cert = findCert(state, binding.certId);
  return {
    udiId: binding.udiId,
    udiCode: udi?.udiCode ?? '(已删除)',
    udiRevision: binding.udiRevision,
    certId: binding.certId,
    certNo: cert?.certNo ?? '(已删除)',
    certVersion: binding.certVersion,
    batches: binding.batchIds.map((batchId) => {
      const batch = findBatch(state, batchId);
      return {
        batchId,
        batchNo: batch?.batchNo ?? '(已删除)',
        revision: batch?.revision ?? 0
      };
    }),
    evidence: binding.evidence.map((item) => ({
      id: item.id,
      title: item.title,
      contentHash: item.contentHash
    })),
    frozenAt: nowIso()
  };
}

/** 乐观并发：两个窗口同时改同一标识（链），先到者生效 */
function detectConflict(
  state: TraceState,
  binding: TraceBinding,
  expectedRevision: number,
  actor: string,
  attemptedAction: string,
  attemptedInput: Record<string, unknown>
): EditConflict | null {
  if (binding.revision === expectedRevision) return null;
  const conflict: EditConflict = {
    id: nextId(state, 'CFL'),
    bindingId: binding.id,
    actor,
    expectedRevision,
    actualRevision: binding.revision,
    attemptedInput,
    attemptedAction,
    status: 'open',
    createdAt: nowIso()
  };
  state.conflicts.unshift(conflict);
  addEvent(state, {
    actor,
    action: '并发冲突被拦截',
    detail:
      `${attemptedAction} 基于链版本 R${expectedRevision}，先到写入已落定为 R${binding.revision}；` +
      '后到输入已保留，未覆盖先到版本。',
    bindingId: binding.id
  });
  return conflict;
}

function ok(state: TraceState, event?: TraceEvent, conflict?: EditConflict): CommitResult {
  return { ok: !conflict, state: structuredClone(state), conflict, event };
}

export function commit(prev: TraceState, action: TraceAction): CommitResult {
  const state: TraceState = structuredClone(prev);
  const ts = nowIso();

  switch (action.type) {
    case 'correct_udi': {
      const udi = findUdi(state, action.udiId);
      if (!udi) throw new Error(`标识不存在：${action.udiId}`);
      const oldCode = udi.udiCode;
      udi.udiCode = action.newCode.trim();
      udi.revision += 1;
      udi.updatedAt = ts;
      const event = addEvent(state, {
        actor: action.actor,
        action: '生产商更正标识',
        detail: `UDI ${oldCode} 更正为 ${udi.udiCode}（R${udi.revision - 1} -> R${udi.revision}）：${action.reason}`,
        bindingId: undefined
      });
      for (const binding of bindingsForUdi(state, udi.id)) {
        binding.udiRevision = udi.revision;
        binding.revision += 1;
        binding.updatedAt = ts;
        propagateBasisChange(
          state,
          binding,
          'udi_corrected',
          `标识编码 ${oldCode} → ${udi.udiCode}，依据版本 R${udi.revision}`
        );
      }
      return ok(state, event);
    }

    case 'revise_certificate': {
      const cert = findCert(state, action.certId);
      if (!cert) throw new Error(`注册证不存在：${action.certId}`);
      if (action.newVersion <= cert.version) {
        throw new Error(`新版本号必须高于当前版本 V${cert.version}`);
      }
      cert.version = action.newVersion;
      cert.superseded = false;
      cert.issuedAt = ts;
      const event = addEvent(state, {
        actor: action.actor,
        action: '注册证换版',
        detail: `${cert.certNo} 换版至 V${cert.version}：${action.reason}`,
        bindingId: undefined
      });
      for (const binding of bindingsForCert(state, cert.id)) {
        binding.certVersion = cert.version;
        binding.revision += 1;
        binding.updatedAt = ts;
        propagateBasisChange(
          state,
          binding,
          'cert_revised',
          `注册证 ${cert.certNo} 换版 V${cert.version}`
        );
      }
      return ok(state, event);
    }

    case 'correct_batch': {
      const batch = findBatch(state, action.batchId);
      if (!batch) throw new Error(`批号不存在：${action.batchId}`);
      const oldNo = batch.batchNo;
      batch.batchNo = action.newBatchNo.trim();
      batch.revision += 1;
      batch.updatedAt = ts;
      const event = addEvent(state, {
        actor: action.actor,
        action: '批号更正',
        detail: `批号 ${oldNo} 更正为 ${batch.batchNo}（R${batch.revision - 1} -> R${batch.revision}）：${action.reason}`
      });
      for (const binding of bindingsForBatch(state, batch.id)) {
        binding.revision += 1;
        binding.updatedAt = ts;
        for (const ev of binding.evidence) {
          if (ev.batchId === batch.id) ev.batchNoAtBinding = batch.batchNo;
        }
        propagateBasisChange(
          state,
          binding,
          'batch_corrected',
          `生产批号 ${oldNo} → ${batch.batchNo}（R${batch.revision}）`
        );
      }
      return ok(state, event);
    }

    case 'split_batch': {
      const source = findBatch(state, action.batchId);
      if (!source) throw new Error(`批号不存在：${action.batchId}`);
      if (action.parts.length === 0) throw new Error('拆分至少需要一个目标批号');
      const partIds: string[] = [];
      for (const part of action.parts) {
        const id = nextId(state, 'BAT');
        state.batches.push({
          id,
          batchNo: part.batchNo.trim(),
          udiId: source.udiId,
          manufacturer: source.manufacturer,
          producedAt: part.producedAt,
          quantity: part.quantity,
          status: 'active',
          revision: 1,
          note: part.note,
          createdAt: ts,
          updatedAt: ts
        });
        partIds.push(id);
      }
      source.status = 'superseded';
      source.replacedBy = partIds;
      source.updatedAt = ts;
      const partLabels = partIds
        .map((id) => findBatch(state, id)?.batchNo)
        .filter(Boolean)
        .join('、');
      const event = addEvent(state, {
        actor: action.actor,
        action: '批号拆分',
        detail: `批号 ${source.batchNo} 拆分为 ${partLabels}（${partIds.length} 个批号）`
      });
      for (const binding of bindingsForBatch(state, source.id)) {
        // 旧批保留在链上（已签发报告仍要指回原批），同时挂入拆分后的新批
        binding.batchIds = Array.from(new Set([...binding.batchIds, ...partIds]));
        binding.revision += 1;
        binding.updatedAt = ts;
        propagateBasisChange(
          state,
          binding,
          'batch_split',
          `批号 ${source.batchNo} 已拆分为 ${partLabels}，需重新核定证据归属`
        );
      }
      return ok(state, event);
    }

    case 'save_binding': {
      const binding = state.bindings.find((item) => item.id === action.bindingId);
      if (!binding) throw new Error(`追溯链不存在：${action.bindingId}`);
      const conflict = detectConflict(
        state,
        binding,
        action.expectedRevision,
        action.actor,
        '保存追溯链',
        { patch: action.patch }
      );
      if (conflict) return ok(state, undefined, conflict);

      if (action.patch.udiId && action.patch.udiId !== binding.udiId) {
        const udi = findUdi(state, action.patch.udiId);
        if (!udi) throw new Error('目标标识不存在');
        binding.udiId = udi.id;
        binding.udiRevision = udi.revision;
      }
      if (action.patch.certId && action.patch.certId !== binding.certId) {
        const cert = findCert(state, action.patch.certId);
        if (!cert) throw new Error('目标注册证不存在');
        binding.certId = cert.id;
        binding.certVersion = cert.version;
      }
      if (action.patch.batchIds) {
        binding.batchIds = action.patch.batchIds;
      }
      binding.revision += 1;
      binding.updatedAt = ts;
      const event = addEvent(state, {
        actor: action.actor,
        action: '编辑追溯链',
        detail: `更新链 ${binding.id} 至 R${binding.revision}`,
        bindingId: binding.id,
        signalId: binding.signalId
      });
      return ok(state, event);
    }

    case 'add_evidence': {
      const binding = state.bindings.find((item) => item.id === action.bindingId);
      if (!binding) throw new Error(`追溯链不存在：${action.bindingId}`);
      const conflict = detectConflict(
        state,
        binding,
        action.expectedRevision,
        action.actor,
        '追加证据',
        { evidence: action.evidence }
      );
      if (conflict) return ok(state, undefined, conflict);

      const batch = findBatch(state, action.evidence.batchId);
      const ref: TraceEvidenceRef = {
        ...action.evidence,
        id: nextId(state, 'EV'),
        batchNoAtBinding: action.evidence.batchNoAtBinding ?? batch?.batchNo ?? '',
        boundAt: ts,
        contentHash: stableHash({
          title: action.evidence.title,
          source: action.evidence.source,
          note: action.evidence.note,
          strength: action.evidence.strength
        })
      };
      binding.evidence.push(ref);
      binding.revision += 1;
      binding.updatedAt = ts;
      const event = addEvent(state, {
        actor: action.actor,
        action: '证据接入追溯链',
        detail: `证据《${ref.title}》绑定批号 ${ref.batchNoAtBinding}，指纹 ${ref.contentHash}`,
        bindingId: binding.id,
        signalId: binding.signalId
      });
      return ok(state, event);
    }

    case 'resolve_pending': {
      const binding = state.bindings.find((item) => item.id === action.bindingId);
      if (!binding) throw new Error(`追溯链不存在：${action.bindingId}`);
      const conflict = detectConflict(
        state,
        binding,
        action.expectedRevision,
        action.actor,
        '补齐标识版本',
        { udiId: action.udiId, udiRevision: action.udiRevision }
      );
      if (conflict) return ok(state, undefined, conflict);

      const udi = findUdi(state, action.udiId);
      if (!udi) throw new Error('标识不存在，无法补齐');
      binding.verificationState = 'verified';
      binding.pendingReason = undefined;
      binding.udiId = udi.id;
      binding.udiRevision = action.udiRevision;
      binding.revision += 1;
      binding.updatedAt = ts;
      // 旧数据挂在 UDI-PENDING 上的批号一并回迁到真实标识
      for (const batch of state.batches) {
        if (binding.batchIds.includes(batch.id) && batch.udiId === 'UDI-PENDING') {
          batch.udiId = udi.id;
          batch.updatedAt = ts;
        }
      }
      for (const report of state.reports.filter((item) => item.bindingId === binding.id)) {
        if (report.status === 'pending_verification') {
          report.status = 'draft';
          report.legacy = false;
          report.updatedAt = ts;
        }
      }
      const event = addEvent(state, {
        actor: action.actor,
        action: '待核数据补齐并重算',
        detail:
          `链 ${binding.id} 补齐标识 ${udi.udiCode} R${action.udiRevision}，` +
          '旧批号与证据依据已重算，关联报告由待核转为草稿。',
        bindingId: binding.id,
        signalId: binding.signalId
      });
      return ok(state, event);
    }

    case 'register_udi': {
      const code = action.udiCode.trim();
      const existing = state.udis.find((item) => item.udiCode === code);
      if (existing) throw new Error(`标识 ${code} 已存在（R${existing.revision}）`);
      const udi = createUdi(state, {
        udiCode: code,
        productName: action.productName.trim(),
        manufacturer: action.manufacturer.trim(),
        model: action.model.trim()
      });
      const event = addEvent(state, {
        actor: action.actor,
        action: '登记器械标识',
        detail: `登记 UDI-DI ${udi.udiCode}（${udi.productName} / ${udi.manufacturer}）。`
      });
      return ok(state, event);
    }

    case 'create_report': {
      const binding = state.bindings.find((item) => item.id === action.bindingId);
      if (!binding) throw new Error('追溯链不存在');
      const report = createReport(state, {
        bindingId: binding.id,
        signalId: binding.signalId,
        title: action.title,
        author: action.author
      });
      const event = addEvent(state, {
        actor: action.author,
        action: '新建审计报告草稿',
        detail: `${report.id} 已建立，当前依据为链 R${binding.revision}。`,
        reportId: report.id,
        bindingId: binding.id,
        signalId: binding.signalId
      });
      return ok(state, event);
    }

    case 'issue_report': {
      const report = state.reports.find((item) => item.id === action.reportId);
      if (!report) throw new Error(`报告不存在：${action.reportId}`);
      if (report.status === 'issued') throw new Error('报告已签发，不能重复签发');
      if (report.status === 'invalidated') {
        throw new Error('报告已因依据变更失效，不能直接签发；请按新依据新建草稿');
      }
      if (report.status === 'pending_verification') {
        throw new Error('标识版本待核，补齐前不得签发');
      }
      const binding = state.bindings.find((item) => item.id === report.bindingId);
      if (!binding) throw new Error('追溯链缺失');
      if (binding.verificationState === 'pending') throw new Error('追溯链待核，不能签发');
      report.status = 'issued';
      report.issuedAt = ts;
      report.updatedAt = ts;
      report.frozenBasis = freezeBasis(state, binding);
      const event = addEvent(state, {
        actor: action.actor,
        action: '审计报告签发',
        detail: `${report.id} 签发，冻结标识 R${report.frozenBasis.udiRevision}、注册证 V${report.frozenBasis.certVersion} 与 ${report.frozenBasis.batches.length} 个批号依据。`,
        reportId: report.id,
        bindingId: binding.id,
        signalId: binding.signalId
      });
      return ok(state, event);
    }

    case 'resolve_reconsideration': {
      const report = state.reports.find((item) => item.id === action.reportId);
      if (!report) throw new Error(`报告不存在：${action.reportId}`);
      const item = report.reconsideration.find((entry) => entry.id === action.itemId);
      if (!item) throw new Error('复议项不存在');
      item.resolved = true;
      item.resolution = action.resolution;
      report.updatedAt = ts;
      const event = addEvent(state, {
        actor: action.actor,
        action: '复议项处理',
        detail: `${report.id} 复议项（${labelOfKind(item.kind)}）已处理：${action.resolution}；原签发依据保持不变。`,
        reportId: report.id
      });
      return ok(state, event);
    }

    case 'resolve_conflict': {
      const conflict = state.conflicts.find((item) => item.id === action.conflictId);
      if (!conflict) throw new Error('冲突记录不存在');
      conflict.status = 'resolved';
      conflict.resolvedAt = ts;
      const labelMap = {
        kept_first: '保留先到版本',
        retried_with_latest: '基于最新版本重做并生效',
        discarded: '放弃后到输入'
      } as const;
      const event = addEvent(state, {
        actor: action.actor,
        action: '冲突处理',
        detail: `${conflict.id}：${labelMap[action.resolution]}；后到输入仍留档可查。`,
        bindingId: conflict.bindingId
      });
      return ok(state, event);
    }

    case 'note_recovery': {
      const event = addEvent(state, {
        actor: action.actor,
        action: '故障恢复',
        detail: action.detail
      });
      return ok(state, event);
    }

    case 'import_snapshot': {
      // 重复导入：不新增任何数据，也不新增审计
      if (state.importHashes.includes(action.payloadHash)) {
        return { ok: true, state: structuredClone(state) };
      }
      const applied = action.apply(state);
      applied.importHashes = [...applied.importHashes, action.payloadHash];
      const event = addEvent(applied, {
        actor: action.actor,
        action: '追溯数据导入',
        detail: `导入载荷指纹 ${action.payloadHash}，去重后生效。`
      });
      return ok(applied, event);
    }

    default: {
      const exhaustiveCheck: never = action;
      throw new Error(`未知动作：${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}

/** 构造侧助手（种子数据/迁移使用） */
export function createUdi(
  state: TraceState,
  input: { udiCode: string; productName: string; manufacturer: string; model: string }
): DeviceUdi {
  const ts = nowIso();
  const udi: DeviceUdi = {
    id: nextId(state, 'UDI'),
    udiCode: input.udiCode,
    productName: input.productName,
    manufacturer: input.manufacturer,
    model: input.model,
    revision: 1,
    createdAt: ts,
    updatedAt: ts
  };
  state.udis.push(udi);
  return udi;
}

export function createCertificate(
  state: TraceState,
  input: { certNo: string; version: number; productName: string; issuer: string; issuedAt?: string }
): RegistrationCertificate {
  const cert: RegistrationCertificate = {
    id: nextId(state, 'CER'),
    certNo: input.certNo,
    version: input.version,
    productName: input.productName,
    issuer: input.issuer,
    issuedAt: input.issuedAt ?? nowIso(),
    superseded: false
  };
  state.certificates.push(cert);
  return cert;
}

export function createBatch(
  state: TraceState,
  input: {
    batchNo: string;
    udiId: string;
    manufacturer: string;
    producedAt: string;
    quantity: number;
  }
): ProductionBatch {
  const ts = nowIso();
  const batch: ProductionBatch = {
    id: nextId(state, 'BAT'),
    batchNo: input.batchNo,
    udiId: input.udiId,
    manufacturer: input.manufacturer,
    producedAt: input.producedAt,
    quantity: input.quantity,
    status: 'active',
    revision: 1,
    createdAt: ts,
    updatedAt: ts
  };
  state.batches.push(batch);
  return batch;
}

export function createBinding(
  state: TraceState,
  input: {
    signalId: string;
    signalTitle: string;
    udiId?: string;
    certId: string;
    batchIds: string[];
    verificationState?: TraceBinding['verificationState'];
    pendingReason?: string;
  }
): TraceBinding {
  const ts = nowIso();
  const udi = input.udiId ? findUdi(state, input.udiId) : undefined;
  const cert = findCert(state, input.certId);
  const binding: TraceBinding = {
    id: nextId(state, 'BND'),
    signalId: input.signalId,
    signalTitle: input.signalTitle,
    udiId: input.udiId ?? 'UDI-PENDING',
    udiRevision: udi?.revision ?? 0,
    certId: input.certId,
    certVersion: cert?.version ?? 0,
    batchIds: input.batchIds,
    evidence: [],
    revision: 1,
    verificationState: input.verificationState ?? (input.udiId ? 'verified' : 'pending'),
    pendingReason: input.pendingReason ?? (input.udiId ? undefined : '旧数据缺少标识版本，待核'),
    createdAt: ts,
    updatedAt: ts
  };
  state.bindings.push(binding);
  return binding;
}

export function createReport(
  state: TraceState,
  input: { bindingId: string; signalId: string; title: string; author: string; legacy?: boolean }
): AuditReport {
  const ts = nowIso();
  const binding = state.bindings.find((item) => item.id === input.bindingId);
  const report: AuditReport = {
    id: nextId(state, 'RPT'),
    bindingId: input.bindingId,
    signalId: input.signalId,
    title: input.title,
    author: input.author,
    status: input.legacy || binding?.verificationState === 'pending' ? 'pending_verification' : 'draft',
    createdAt: ts,
    updatedAt: ts,
    reconsideration: [],
    legacy: input.legacy ?? binding?.verificationState === 'pending'
  };
  state.reports.unshift(report);
  return report;
}
