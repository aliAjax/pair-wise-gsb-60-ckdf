import type { BasisChangeKind, ReportStatus } from './types';

export const reportStatusMeta: Record<
  ReportStatus,
  { label: string; badge: string; hint: string }
> = {
  draft: {
    label: '未签发',
    badge: 'variant-soft-secondary',
    hint: '依据变更将立即失效'
  },
  invalidated: {
    label: '已失效',
    badge: 'variant-soft-error',
    hint: '原草稿因依据变更失效，需按新依据重做'
  },
  issued: {
    label: '已签发',
    badge: 'variant-soft-success',
    hint: '冻结原依据，依据变更只登记复议项'
  },
  pending_verification: {
    label: '待核',
    badge: 'variant-soft-warning',
    hint: '旧数据缺标识版本，补齐后重算'
  }
};

export const changeKindLabels: Record<BasisChangeKind, string> = {
  udi_corrected: '标识更正',
  cert_revised: '注册证换版',
  batch_corrected: '批号更正',
  batch_split: '批号拆分'
};

export function shortTime(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ');
}

export function shortDate(iso: string): string {
  return iso.slice(0, 10);
}
