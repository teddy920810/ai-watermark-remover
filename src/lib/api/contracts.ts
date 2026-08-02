import { z } from 'zod';
import { isUploadKey, validateUploadMetadata } from '../upload/validation';

const uploadSchema = z.object({ contentType: z.string(), size: z.number() }).strict();
const createJobSchema = z.object({ inputKey: z.string().refine(isUploadKey, 'Invalid upload key') }).strict();

export function parseUploadRequest(input: unknown) {
  const value = uploadSchema.parse(input);
  const result = validateUploadMetadata(value);
  if (!result.ok) throw new Error(result.message);
  return value;
}

export function parseCreateJob(input: unknown) {
  return createJobSchema.parse(input);
}
