import { z } from 'zod';

export const planModeSchema = z.enum(['add-only', 'merge', 'replace']);
export const deckStatusSchema = z.enum(['verified', 'playable', 'unsupported', 'unknown']);
export const exportFormatSchema = z.enum(['json', 'markdown']);
export const planIdSchema = z.string().uuid();
