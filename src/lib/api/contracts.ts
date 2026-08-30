import { z } from 'zod';
import { isUploadKey } from '../upload/upload-key';
import { validateUploadMetadata } from '../upload/validation';
import { processingOperationSchema } from '../jobs/job';

const uploadSchema = z.object({ contentType: z.string(), size: z.number() }).strict();
const createJobSchema = z.object({
  inputKey: z.string().refine(isUploadKey, 'Invalid upload key'),
  maskKey: z.string().refine(isUploadKey, 'Invalid mask key').optional(),
  operation: processingOperationSchema.default('watermark-removal'),
}).strict().superRefine((value, context) => {
  if (value.operation === 'object-removal') {
    if (!value.maskKey) {
      context.addIssue({ code: 'custom', path: ['maskKey'], message: 'Mask is required for object removal' });
    } else if (value.maskKey === value.inputKey) {
      context.addIssue({ code: 'custom', path: ['maskKey'], message: 'Mask must be a separate upload' });
    } else if (!value.maskKey.endsWith('.png')) {
      context.addIssue({ code: 'custom', path: ['maskKey'], message: 'Mask must be a PNG upload' });
    }
  } else if (value.maskKey) {
    context.addIssue({ code: 'custom', path: ['maskKey'], message: 'Mask is only supported for object removal' });
  }
});

export function parseUploadRequest(input: unknown) {
  const value = uploadSchema.parse(input);
  const result = validateUploadMetadata(value);
  if (!result.ok) throw new Error(result.message);
  return value;
}

export function parseCreateJob(input: unknown) {
  return createJobSchema.parse(input);
}
