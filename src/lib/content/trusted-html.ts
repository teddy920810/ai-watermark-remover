import { z } from 'zod';

const activeHtmlPatterns = [
  /<script\b/i,
  /<iframe\b/i,
  /\son[a-z]+\s*=/i,
  /javascript\s*:/i,
];

export const trustedHtmlSchema = z.string().min(1).refine(
  (html) => activeHtmlPatterns.every((pattern) => !pattern.test(html)),
  'HTML must not contain scripts, iframes, event handlers, or javascript: URLs.',
);
