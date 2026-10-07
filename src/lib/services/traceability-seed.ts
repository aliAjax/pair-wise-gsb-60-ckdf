import type { TraceabilityState } from '$lib/models/traceability';

/**
 * 与信号台账（seed.ts）联动的追溯种子数据：
 * - DI-WS5 模拟旧系统迁入、缺标识版本的记录，加载后进入待核；
 * - RPT-2026-0041 签发后注册证换版，演示“已签发保留原依据 + 复议项”；
 * - IMP-IP8-2026-0001 已在 importedKeys 中，演示重复导入不新增审计。
 */
export const seedTraceability: TraceabilityState = {
  certificates: [
    {
      id: 'CERT-IP800',
      certNumber: '国械注准20263140082',
      version: 2,
      issuedAt: '2026-03-15',
      validUntil: '2031-03-14',
      revisions: [
        {
          version: 1,
          certNumber: '国械注准20263140082',
          validUntil: '2031-03-14',
          changedAt: '2026-03-15T01:00:00.000Z',
          reason: '初始注册',
          actor: '注册事务部'
        },
        {
          version: 2,
          certNumber: '国械注准20263140082',
          validUntil: '2031-03-14',
          changedAt: '2026-07-01T02:00:00.000Z',
          reason: '变更生产地址（同一注册证编号换版）',
          actor: '注册事务部'
        }
      ]
    },
    {
      id: 'CERT-M12',
      certNumber: '国械注准20263070451',
      version: 1,
      issuedAt: '2026-01-20',
      validUntil: '2031-01-19',
      revisions: [
        {
          version: 1,
          certNumber: '国械注准20263070451',
          validUntil: '2031-01-19',
          changedAt: '2026-01-20T01:00:00.000Z',
          reason: '初始注册',
          actor: '注册事务部'
        }
      ]
    },
    {
      id: 'CERT-D9',
      certNumber: '国械注准20263210117',
      version: 3,
      issuedAt: '2025-06-01',
      validUntil: '2031-09-30',
      revisions: [
        {
          version: 1,
          certNumber: '国械注准20253210117',
          validUntil: '2030-05-31',
          changedAt: '2025-06-01T01:00:00.000Z',
          reason: '初始注册',
          actor: '注册事务部'
        },
        {
          version: 2,
          certNumber: '国械注准20263210117',
          validUntil: '2030-05-31',
          changedAt: '2026-01-12T01:00:00.000Z',
          reason: '注册证编号升位换版',
          actor: '注册事务部'
        },
        {
          version: 3,
          certNumber: '国械注准20263210117',
          validUntil: '2031-09-30',
          changedAt: '2026-09-30T01:30:00.000Z',
          reason: '产品标准升级换版，有效期顺延',
          actor: '注册事务部'
        }
      ]
    },
    {
      id: 'CERT-WS5',
      certNumber: '国械注准20243060788',
      version: 1,
      issuedAt: '2024-11-02',
      validUntil: '2029-11-01',
      revisions: [
        {
          version: 1,
          certNumber: '国械注准20243060788',
          validUntil: '2029-11-01',
          changedAt: '2024-11-02T01:00:00.000Z',
          reason: '初始注册',
          actor: '注册事务部'
        }
      ]
    }
  ],
  identifiers: [
    {
      id: 'DI-IP800',
      udi: '06941234560011',
      productName: '智能输液泵 IP-800',
      manufacturer: '恒泽医疗器械有限公司',
      version: 2,
      status: 'active',
      certId: 'CERT-IP800',
      lotIds: ['LOT-IP8-260401', 'LOT-IP8-260403', 'LOT-IP8-260407'],
      revisions: [
        {
          version: 1,
          udi: '06941234560011',
          productName: '智能输液泵 IP-800',
          manufacturer: '恒泽医疗器械有限公司',
          changedAt: '2026-04-01T02:00:00.000Z',
          reason: '初始建档',
          actor: '质量部'
        },
        {
          version: 2,
          udi: '06941234560011',
          productName: '智能输液泵 IP-800',
          manufacturer: '恒泽医疗器械有限公司',
          changedAt: '2026-07-01T02:10:00.000Z',
          reason: '随注册证换版同步生产地址信息',
          actor: '质量部'
        }
      ],
      updatedAt: '2026-07-01T02:10:00.000Z'
    },
    {
      id: 'DI-M12',
      udi: '06941234560028',
      productName: '多参数监护仪 M12',
      manufacturer: '恒泽医疗器械有限公司',
      version: 1,
      status: 'active',
      certId: 'CERT-M12',
      lotIds: ['LOT-M12-251118'],
      revisions: [
        {
          version: 1,
          udi: '06941234560028',
          productName: '多参数监护仪 M12',
          manufacturer: '恒泽医疗器械有限公司',
          changedAt: '2025-11-18T02:00:00.000Z',
          reason: '初始建档',
          actor: '质量部'
        }
      ],
      updatedAt: '2025-11-18T02:00:00.000Z'
    },
    {
      id: 'DI-D9',
      udi: '06941234560035',
      productName: '双相波除颤器 D9',
      manufacturer: '恒泽医疗器械有限公司',
      version: 2,
      status: 'active',
      certId: 'CERT-D9',
      lotIds: ['LOT-D9-260722'],
      revisions: [
        {
          version: 1,
          udi: '06941234560035',
          productName: '双相波除颤器 D9',
          manufacturer: '恒泽医疗器械有限公司',
          changedAt: '2026-07-22T02:00:00.000Z',
          reason: '初始建档',
          actor: '质量部'
        },
        {
          version: 2,
          udi: '06941234560035',
          productName: '双相波除颤器 D9',
          manufacturer: '恒泽医疗器械有限公司',
          changedAt: '2026-08-05T06:00:00.000Z',
          reason: '生产商更正铭牌制造商全称',
          actor: '质量部'
        }
      ],
      updatedAt: '2026-08-05T06:00:00.000Z'
    },
    {
      id: 'DI-WS5',
      udi: '06941234560042',
      productName: '影像工作站 WS-5',
      manufacturer: '恒泽医疗器械有限公司',
      version: null,
      status: 'pending_review',
      certId: 'CERT-WS5',
      lotIds: ['LOT-SW-531'],
      revisions: [],
      updatedAt: '2026-05-20T08:00:00.000Z'
    }
  ],
  lots: [
    {
      id: 'LOT-IP8-260401',
      identifierId: 'DI-IP800',
      lotNumber: 'IP8-260401',
      version: 1,
      status: 'active',
      manufacturedAt: '2026-04-01',
      quantity: 2048,
      splitInto: []
    },
    {
      id: 'LOT-IP8-260403',
      identifierId: 'DI-IP800',
      lotNumber: 'IP8-260403',
      version: 1,
      status: 'active',
      manufacturedAt: '2026-04-03',
      quantity: 1600,
      splitInto: []
    },
    {
      id: 'LOT-IP8-260407',
      identifierId: 'DI-IP800',
      lotNumber: 'IP8-260407',
      version: 1,
      status: 'active',
      manufacturedAt: '2026-04-07',
      quantity: 900,
      splitInto: [],
      note: '导入批次 IMP-IP8-2026-0001'
    },
    {
      id: 'LOT-M12-251118',
      identifierId: 'DI-M12',
      lotNumber: 'M12-251118',
      version: 1,
      status: 'active',
      manufacturedAt: '2025-11-18',
      quantity: 876,
      splitInto: []
    },
    {
      id: 'LOT-D9-260722',
      identifierId: 'DI-D9',
      lotNumber: 'D9-260722',
      version: 1,
      status: 'active',
      manufacturedAt: '2026-07-22',
      quantity: 120,
      splitInto: []
    },
    {
      id: 'LOT-SW-531',
      identifierId: 'DI-WS5',
      lotNumber: 'SW-5.3.1',
      version: 1,
      status: 'active',
      manufacturedAt: '2026-06-01',
      quantity: 310,
      splitInto: [],
      note: '软件版本批'
    }
  ],
  reports: [
    {
      id: 'RPT-2026-0038',
      title: 'SIG-2026-018 输注泵阻塞报警追溯报告',
      signalId: 'SIG-2026-018',
      evidenceIds: ['E-018-01', 'E-018-02', 'E-018-03'],
      identifierId: 'DI-IP800',
      lotIds: ['LOT-IP8-260401', 'LOT-IP8-260403'],
      status: 'draft',
      basis: {
        identifierId: 'DI-IP800',
        identifierUdi: '06941234560011',
        identifierVersion: 2,
        certId: 'CERT-IP800',
        certNumber: '国械注准20263140082',
        certVersion: 2,
        lots: [
          { lotId: 'LOT-IP8-260401', lotNumber: 'IP8-260401', version: 1, status: 'active' },
          { lotId: 'LOT-IP8-260403', lotNumber: 'IP8-260403', version: 1, status: 'active' }
        ],
        capturedAt: '2026-09-28T08:40:00.000Z'
      },
      issuedAt: null,
      invalidatedAt: null,
      invalidationReason: null,
      reconsiderations: [],
      createdAt: '2026-09-28T08:40:00.000Z'
    },
    {
      id: 'RPT-2026-0041',
      title: 'SIG-2026-019 除颤器温升事件追溯报告',
      signalId: 'SIG-2026-019',
      evidenceIds: ['E-019-01', 'E-019-02'],
      identifierId: 'DI-D9',
      lotIds: ['LOT-D9-260722'],
      status: 'issued',
      basis: {
        identifierId: 'DI-D9',
        identifierUdi: '06941234560035',
        identifierVersion: 2,
        certId: 'CERT-D9',
        certNumber: '国械注准20263210117',
        certVersion: 2,
        lots: [{ lotId: 'LOT-D9-260722', lotNumber: 'D9-260722', version: 1, status: 'active' }],
        capturedAt: '2026-09-26T09:00:00.000Z'
      },
      issuedAt: '2026-09-26T09:00:00.000Z',
      invalidatedAt: null,
      invalidationReason: null,
      reconsiderations: [
        {
          id: 'RC-0041-01',
          reason: '注册证换版',
          before: '注册证 V2（有效期至 2030-05-31）',
          after: '注册证 V3（有效期至 2031-09-30）',
          createdAt: '2026-09-30T01:30:00.000Z',
          status: 'open'
        }
      ],
      createdAt: '2026-09-24T03:00:00.000Z'
    },
    {
      id: 'RPT-2026-0035',
      title: 'SIG-2026-015 监护仪电池续航追溯报告',
      signalId: 'SIG-2026-015',
      evidenceIds: ['E-015-01', 'E-015-02'],
      identifierId: 'DI-M12',
      lotIds: ['LOT-M12-251118'],
      status: 'issued',
      basis: {
        identifierId: 'DI-M12',
        identifierUdi: '06941234560028',
        identifierVersion: 1,
        certId: 'CERT-M12',
        certNumber: '国械注准20263070451',
        certVersion: 1,
        lots: [{ lotId: 'LOT-M12-251118', lotNumber: 'M12-251118', version: 1, status: 'active' }],
        capturedAt: '2026-09-26T02:00:00.000Z'
      },
      issuedAt: '2026-09-26T02:00:00.000Z',
      invalidatedAt: null,
      invalidationReason: null,
      reconsiderations: [],
      createdAt: '2026-09-25T06:00:00.000Z'
    },
    {
      id: 'RPT-2026-0029',
      title: 'SIG-2026-011 影像工作站测量偏差追溯报告',
      signalId: 'SIG-2026-011',
      evidenceIds: ['E-011-01'],
      identifierId: 'DI-WS5',
      lotIds: ['LOT-SW-531'],
      status: 'draft',
      basis: {
        identifierId: 'DI-WS5',
        identifierUdi: '06941234560042',
        identifierVersion: null,
        certId: 'CERT-WS5',
        certNumber: '国械注准20243060788',
        certVersion: 1,
        lots: [{ lotId: 'LOT-SW-531', lotNumber: 'SW-5.3.1', version: 1, status: 'active' }],
        capturedAt: '2026-08-15T02:00:00.000Z'
      },
      issuedAt: null,
      invalidatedAt: null,
      invalidationReason: null,
      reconsiderations: [],
      createdAt: '2026-08-15T02:00:00.000Z'
    }
  ],
  audit: [
    {
      id: 'TA-SEED-01',
      actor: '质量部',
      action: '标识更正',
      detail: 'DI-D9 标识 V1 -> V2：生产商更正铭牌制造商全称。',
      createdAt: '2026-08-05T06:00:00.000Z'
    },
    {
      id: 'TA-SEED-02',
      actor: '安全评审专员',
      action: '报告签发',
      detail: 'RPT-2026-0041 依据标识 V2 / 注册证 V2 / 批号 D9-260722 V1 签发。',
      createdAt: '2026-09-26T09:00:00.000Z'
    },
    {
      id: 'TA-SEED-03',
      actor: '注册事务部',
      action: '注册证换版',
      detail: 'CERT-D9 注册证 V2 -> V3：产品标准升级换版，有效期顺延。',
      createdAt: '2026-09-30T01:30:00.000Z'
    },
    {
      id: 'TA-SEED-04',
      actor: '系统',
      action: '新增复议项',
      detail: 'RPT-2026-0041 已签发报告保留原依据，新增复议项：注册证换版。',
      createdAt: '2026-09-30T01:30:01.000Z'
    },
    {
      id: 'TA-SEED-05',
      actor: '系统',
      action: '旧数据待核',
      detail: 'DI-WS5 缺少标识版本，进入待核队列，补齐后重算相关报告。',
      createdAt: '2026-10-01T00:00:00.000Z'
    }
  ],
  importedKeys: ['IMP-IP8-2026-0001']
};
