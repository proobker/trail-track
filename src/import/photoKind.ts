import type { Photo } from '../model/types';

/** What a photo most likely is, judged from its file name and the phone folder it came from. */
export type PhotoKind = 'camera' | 'screenshot' | 'document' | 'saved' | 'chat';

export const JUNK_KINDS = ['screenshot', 'document', 'saved', 'chat'] as const;

export const KIND_LABEL: Record<(typeof JUNK_KINDS)[number], string> = {
  screenshot: 'Screenshots',
  document: 'Scans & documents',
  saved: 'Downloads & saved images',
  chat: 'Chat app images',
};

const SCREENSHOT = /screen[ _-]?shot|screen[ _-]?record|^scrn/i;
const DOCUMENT = /scan|camscanner|document|^doc[_-]?\d|^pdf/i;
const SAVED_FOLDER = /download|pinterest|reddit|twitter|instagram|facebook|saved/i;
const SAVED_NAME = /^(fb_img_|download|images?\s*(\(\d+\))?\.|unnamed|pinterest)/i;
const CHAT_FOLDER = /whatsapp|telegram|messenger|signal|viber|wechat/i;
const CHAT_NAME = /-WA\d{3,}|^received_\d|^messenger_creation/i;

export function photoKind(p: Pick<Photo, 'fileName' | 'folder'>): PhotoKind {
  const name = p.fileName;
  const folder = p.folder ?? '';
  if (SCREENSHOT.test(name) || SCREENSHOT.test(folder)) return 'screenshot';
  if (DOCUMENT.test(name) || DOCUMENT.test(folder)) return 'document';
  if (CHAT_NAME.test(name) || CHAT_FOLDER.test(folder)) return 'chat';
  if (SAVED_NAME.test(name) || SAVED_FOLDER.test(folder)) return 'saved';
  return 'camera';
}
