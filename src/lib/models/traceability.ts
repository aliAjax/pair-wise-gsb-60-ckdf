import { z } from 'zod';

export const identifierStatuses = ['active', 'pending_review'] as const;
export const lotStatuses = ['active', 'split'] as const;
export const reportStatuses = ['draft', 'issued', 'invalidated'] as const;

export const correctIdentifierSchema = z.object({
  id: z.string().min(1),
  baseVersion: z.coerce.number().int().min(1),
  udi: z.string().trim().min(6, '器械唯一标识至少 6 个字符'),
  productName: z.string().trim().min(2, '请输入产品名称'),
  manufacturer: z.string().trim().min(2, '请输入生产商名称'),
  reason: z.string().trim().min(4, '请填写更正原因'),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const splitLotSchema = z.object({
  lotId: z.string().min(1),
  newLotNumbers: z.string().trim().min(2, '请填写拆分后的批号'),
  reason: z.string().trim().min(4, '请填写拆分原因'),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const renewCertSchema = z.object({
  certId: z.string().min(1),
  certNumber: z.string().trim().min(6, '请输入注册证编号'),
  validUntil: z.string().min(1, '请选择有效期'),
  reason: z.string().trim().min(4, '请填写换版原因'),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const completeReviewSchema = z.object({
  id: z.string().min(1),
  version: z.coerce.number().int().min(1, '版本号至少为 1'),
  note: z.string().trim().min(4, '请填写补齐说明'),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const createReportSchema = z.object({
  title: z.string().trim().min(6, '报告标题至少 6 个字符'),
  identifierId: z.string().min(1, '请选择器械标识'),
  signalId: z.string().optional(),
  actor: z.string().trim().min(2, '请填写操作人')
});

export const importRecordSchema = z.object({
  importKey: z.string().trim().min(4, '导入记录缺少 importKey'),
  udi: z.string().trim().min(6, '导入记录缺少器械标识'),
  lotNumber: z.string().trim().min(2, '导入记录缺少批号'),
  manufacturedAt: z.string().min(1, '导入记录缺少生产日期'),
  quantity: z.coerce.number().int().min(1, '导入数量至少为 1')
});

export type IdentifierStatus = (typeof identifierStatuses)[number];
export type LotStatus = (typeof lotStatuses)[number];
export type ReportStatus = (typeof reportStatuses)[number];
export type ImportRecord = z.infer<typeof importRecordSchema>;

export interface CertRevision {
  version: number;
  certNumber: string;
  validUntil: string;
  changedAt: string;
  reason: string;
  actor: string;
}

export interface RegistrationCertificate {
  id: string;
  certNumber: string;
  version: number;
  issuedAt: string;
  validUntil: string;
  revisions: CertRevision[];
}

export interface ProductionLot {
  id: string;
  identifierId: string;
  lotNumber: string;
  version: number;
  status: LotStatus;
  manufacturedAt: string;
  quantity: number;
  splitInto: string[];
  note?: string;
}

export interface IdentifierRevision {
  version: number;
  udi: string;
  productName: string;
  manufacturer: string;
  changedAt: string;
  reason: string;
  actor: string;
}

export interface DeviceIdentifier {
  id: string;
  udi: string;
  productName: string;
  manufacturer: string;
  /** null 表示旧数据缺版本，进入待核 */
  version: number | null;
  status: IdentifierStatus;
  certId: string;
  lotIds: string[];
  revisions: IdentifierRevision[];
  updatedAt: string;
}

export interface ReportBasisLot {
  lotId: string;
  lotNumber: string;
  version: number;
  status: LotStatus;
}

/** 报告签发/创建时冻结的追溯依据快照 */
export interface ReportBasis {
  identifierId: string;
  identifierUdi: string;
  identifierVersion: number | null;
  certId: string;
  certNumber: string;
  certVersion: number;
  lots: ReportBasisLot[];
  capturedAt: string;
}

export interface ReconsiderationItem {
  id: string;
  reason: string;
  before: string;
  after: string;
  createdAt: string;
  status: 'open' | 'acknowledged';
}

export interface TraceabilityReport {
  id: string;
  title: string;
  signalId: string | null;
  evidenceIds: string[];
  identifierId: string;
  lotIds: string[];
  status: ReportStatus;
  basis: ReportBasis;
  issuedAt: string | null;
  invalidatedAt: string | null;
  invalidationReason: string | null;
  reconsiderations: ReconsiderationItem[];
  createdAt: string;
}

export interface TraceAuditEntry {
  id: string;
  actor: string;
  action: string;
  detail: string;
  createdAt: string;
}

export interface TraceabilityState {
  identifiers: DeviceIdentifier[];
  certificates: RegistrationCertificate[];
  lots: ProductionLot[];
  reports: TraceabilityReport[];
  audit: TraceAuditEntry[];
  importedKeys: string[];
}

export interface SnapshotMeta {
  id: string;
  createdAt: string;
}

export interface TraceabilitySnapshot extends SnapshotMeta {
  state: TraceabilityState;
}

export interface IdentifierConflict {
  identifierId: string;
  attemptedBaseVersion: number;
  currentVersion: number;
  current: {
    udi: string;
    productName: string;
    manufacturer: string;
    updatedAt: string;
    lastActor: string;
  };
}

export type StoreResult =
  | { ok: true; message?: string }
  | {
      ok: false;
      message: string;
      conflict?: IdentifierConflict;
      recoveredFrom?: SnapshotMeta;
    };
