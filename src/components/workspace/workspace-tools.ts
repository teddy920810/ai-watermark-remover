import type { ProductOperation } from '../../lib/contracts/operation-catalog';
import { appOperationPath } from './app-entry';

/** Navigation describes existing operations; it never selects a Provider or price. */
export const workspaceTools = [
  { id: 'gemini', label: 'Gemini Watermark Remover', short: 'Gemini Remover', href: '/app/free/gemini', free: true, icon: 'gemini', description: 'Remove visible Gemini watermarks from images and videos on your device.' },
  { id: 'tiktok', label: 'TikTok Video Downloader', short: 'TikTok Video', href: '/app/free/tiktok', free: true, icon: 'link', description: 'Paste a TikTok video link, preview it, and save an available MP4.' },
  { id: 'image-watermark', label: 'Image Watermark Remover', short: 'Image Watermark', href: appOperationPath('image-watermark'), free: false, icon: 'image', description: 'Remove watermarks from images with Standard processing.' },
  { id: 'image-watermark-pro', label: 'PRO Watermark Remover', short: 'PRO Watermark', href: appOperationPath('image-watermark-pro'), free: false, icon: 'pro', description: 'Use PRO processing for image watermark removal.' },
  { id: 'background-removal', label: 'Background Remover', short: 'Background Remover', href: appOperationPath('background-removal'), free: false, icon: 'background', description: 'Remove the background and export a transparent PNG.' },
  { id: 'object-removal', label: 'Object Remover', short: 'Object Remover', href: appOperationPath('object-removal'), free: false, icon: 'object', description: 'Select unwanted objects to remove from your image.' },
  { id: 'video-watermark', label: 'Video Watermark Remover', short: 'Video Watermark', href: appOperationPath('video-watermark'), free: false, icon: 'video', description: 'Remove video watermarks. Review the cost before processing.' },
] as const;
export type WorkspaceToolId = typeof workspaceTools[number]['id'];
export function workspaceToolLabel(operation: ProductOperation) {
  return workspaceTools.find(tool => tool.id === operation)?.label ?? 'Image Refinement';
}
