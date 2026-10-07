import { fail } from '@sveltejs/kit';
import {
  completeReviewSchema,
  correctIdentifierSchema,
  createReportSchema,
  importRecordSchema,
  renewCertSchema,
  splitLotSchema
} from '$lib/models/traceability';
import { z } from 'zod';

function failure(error: { issues: Array<{ message: string }> }) {
  return fail(400, {
    message: error.issues[0]?.message ?? '表单校验失败'
  });
}

export const actions = {
  correct: async ({ request }) => {
    const formData = await request.formData();
    const parsed = correctIdentifierSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);
    return { correct: parsed.data };
  },

  split: async ({ request }) => {
    const formData = await request.formData();
    const parsed = splitLotSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);

    const newLotNumbers = Array.from(
      new Set(
        parsed.data.newLotNumbers
          .split(/[,，、\s]+/)
          .map((item) => item.trim())
          .filter(Boolean)
      )
    );
    if (newLotNumbers.length < 2) {
      return fail(400, { message: '拆分后至少需要两个不同的批号。' });
    }
    return { split: { ...parsed.data, newLotNumbers } };
  },

  renewCert: async ({ request }) => {
    const formData = await request.formData();
    const parsed = renewCertSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);
    return { renewCert: parsed.data };
  },

  complete: async ({ request }) => {
    const formData = await request.formData();
    const parsed = completeReviewSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);
    return { complete: parsed.data };
  },

  createReport: async ({ request }) => {
    const formData = await request.formData();
    const parsed = createReportSchema.safeParse(Object.fromEntries(formData));
    if (!parsed.success) return failure(parsed.error);
    const evidenceRaw = String(formData.get('evidenceIds') ?? '');
    return {
      createdReport: {
        ...parsed.data,
        evidenceIds: evidenceRaw ? evidenceRaw.split(',').filter(Boolean) : []
      }
    };
  },

  importBatch: async ({ request }) => {
    const formData = await request.formData();
    const payload = String(formData.get('payload') ?? '').trim();
    const actor = String(formData.get('actor') ?? '').trim() || '安全评审专员';
    if (!payload) return fail(400, { message: '请粘贴要导入的 JSON 记录。' });

    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      return fail(400, { message: 'JSON 解析失败，请检查格式。' });
    }
    const records = Array.isArray(json) ? json : [json];
    const parsed = z.array(importRecordSchema).safeParse(records);
    if (!parsed.success) return failure(parsed.error);
    return { imported: { records: parsed.data, actor } };
  }
};
