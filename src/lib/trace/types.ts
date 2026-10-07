/**
 * 器械追溯领域模型
 *
 * 把器械唯一标识（UDI-DI）、注册证（可换版）、生产批号（可拆分/更正）
 * 与信号证据接成一条可复核的追溯链。链上每一环都带版本号与失效链，
 * 审计报告在签发时冻结当时依据；依据变更后：
 *  - 未签发（草稿）报告立即失效；
 *  - 已签发报告保留原冻结依据，并登记复议项。
 */

export type BasisChangeKind = 'udi_corrected' | 'cert_revised' | 'batch_corrected' | 'batch_split';

export type ReportStatus = 'draft' | 'invalidated' | 'issued' | 'pending_verification';

export type ConflictStatus = 'open' | 'resolved';

/** 医疗器械注册证（每次换版产生一条新版本记录，旧版保留） */
export interface RegistrationCertificate {
  id: string;
  /** 注册证编号，换版时编号不变，version 递增 */
  certNo: string;
  version: number;
  productName: string;
  issuer: string;
  issuedAt: string;
  /** 新版签发后旧版置为 true，追溯时仍可引用 */
  superseded: boolean;
  supersededBy?: string;
}

/** 器械唯一标识（UDI-DI），生产商更正标识时形成新版本 */
export interface DeviceUdi {
  id: string;
  /** 标识编码本体；生产商更正编码会产生新记录，故此处不再变化 */
  udiCode: string;
  productName: string;
  manufacturer: string;
  model: string;
  /** 当前版本号，从 1 开始；更正一次 +1 */
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** 生产批号。一个标识可关联多个批号；批号可被拆分或更正。 */
export interface ProductionBatch {
  id: string;
  batchNo: string;
  udiId: string;
  manufacturer: string;
  producedAt: string;
  quantity: number;
  status: 'active' | 'superseded';
  /** 更正时递增（批号本体改写） */
  revision: number;
  /** 拆分场景：本批被哪些批号替代；一般更正时指向替代批号自身 */
  replacedBy?: string[];
  note?: string;
  createdAt: string;
  updatedAt: string;
}

/** 追溯链上引用的信号证据（带内容指纹，事后被改动可识别） */
export interface TraceEvidenceRef {
  id: string;
  signalId: string;
  title: string;
  source: string;
  evidenceType: string;
  strength: string;
  batchId: string;
  batchNoAtBinding: string;
  note: string;
  contentHash: string;
  boundAt: string;
}

/**
 * 追溯绑定：一条链 = 标识某版本 + 注册证某版本 + 一组批号 + 证据。
 * 链版本随任一环节变更递增，用于乐观并发控制。
 */
export interface TraceBinding {
  id: string;
  signalId: string;
  signalTitle: string;
  udiId: string;
  udiRevision: number;
  certId: string;
  certVersion: number;
  batchIds: string[];
  evidence: TraceEvidenceRef[];
  /** 链结构版本，任意写入 +1，作为乐观锁的 expectedRevision */
  revision: number;
  /** 旧数据迁移时标识版本缺失，进入待核 */
  verificationState: 'verified' | 'pending';
  pendingReason?: string;
  createdAt: string;
  updatedAt: string;
}

/** 报告签发时冻结的依据快照 */
export interface FrozenBasis {
  udiId: string;
  udiCode: string;
  udiRevision: number;
  certId: string;
  certNo: string;
  certVersion: number;
  batches: Array<{ batchId: string; batchNo: string; revision: number }>;
  evidence: Array<{ id: string; title: string; contentHash: string }>;
  frozenAt: string;
}

/** 复议项：已签发报告的依据后来发生变化，只登记、不改写原结论 */
export interface ReconsiderationItem {
  id: string;
  kind: BasisChangeKind;
  detail: string;
  detectedAt: string;
  resolved: boolean;
  resolution?: string;
}

export interface AuditReport {
  id: string;
  bindingId: string;
  signalId: string;
  title: string;
  author: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  issuedAt?: string;
  /** 签发时刻冻结的依据；草稿被失效后仍保留，说明"当时引用的是哪一版" */
  frozenBasis?: FrozenBasis;
  invalidatedAt?: string;
  invalidReason?: string;
  reconsideration: ReconsiderationItem[];
  /** 旧数据缺标识版本时直接生成的待核报告 */
  legacy?: boolean;
}

/** 追溯事件日志，只追加 */
export interface TraceEvent {
  id: string;
  actor: string;
  action: string;
  detail: string;
  signalId?: string;
  reportId?: string;
  bindingId?: string;
  createdAt: string;
}

/** 后到窗口的写入：输入被保留，冲突显式展示 */
export interface EditConflict {
  id: string;
  bindingId: string;
  actor: string;
  /** 后到窗口依据的链版本 */
  expectedRevision: number;
  /** 先到窗口已落定的链版本 */
  actualRevision: number;
  /** 后到窗口保留下来的输入 */
  attemptedInput: Record<string, unknown>;
  attemptedAction: string;
  status: ConflictStatus;
  createdAt: string;
  resolvedAt?: string;
}

export interface TraceSnapshot {
  id: string;
  createdAt: string;
  state: TraceState;
  /** 触发本次快照的事件描述（恢复时可核对） */
  reason: string;
}

export interface TraceState {
  certificates: RegistrationCertificate[];
  udis: DeviceUdi[];
  batches: ProductionBatch[];
  bindings: TraceBinding[];
  reports: AuditReport[];
  events: TraceEvent[];
  conflicts: EditConflict[];
  /** 已成功导入载荷的指纹，重复导入直接忽略且不新增审计 */
  importHashes: string[];
  /** 单调钟，仅用于生成事件/冲突 ID */
  seq: number;
}

/** 所有写操作的统一返回：冲突时不写入，保留输入 */
export interface CommitResult {
  ok: boolean;
  state: TraceState;
  conflict?: EditConflict;
  /** 本次写入追加的事件（UI 可提示） */
  event?: TraceEvent;
}

export function isOpenReport(status: ReportStatus): boolean {
  return status === 'draft' || status === 'invalidated';
}
