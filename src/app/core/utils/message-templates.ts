import type { PositionLevel } from '../models/firestore.models';

/** 相手の役職に応じた丁寧語レベル。会長・幹部には敬語多めの文面を出す。 */
export type PolitenessTier = 'peer' | 'senior';

export interface MessageTemplate {
  id: string;
  label: string;
  peer: string;
  senior: string;
}

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    id: 'greeting',
    label: '挨拶',
    peer: 'はじめまして！よろしくお願いします。',
    senior: 'はじめまして。ご縁をいただき光栄です。今後ともどうぞよろしくお願いいたします。',
  },
  {
    id: 'thanks',
    label: 'お礼',
    peer: 'ありがとうございます！',
    senior: 'この度はありがとうございます。心より御礼申し上げます。',
  },
  {
    id: 'request',
    label: '相談・お願い',
    peer: '少しお時間いただけますか？相談したいことがあります。',
    senior: 'お忙しいところ恐れ入ります。もしお時間よろしければ、少しご相談させていただけますでしょうか。',
  },
  {
    id: 'closing',
    label: '締めの挨拶',
    peer: 'それでは、またお話しできるのを楽しみにしています。',
    senior: 'それでは、貴重なお時間をいただきありがとうございました。今後ともどうぞよろしくお願いいたします。',
  },
];

/** 会長・幹部には敬語多めの例文を出す。それ以外(一般会員・未設定)は通常の丁寧語。 */
export function politenessTierFor(positionLevel: PositionLevel | undefined): PolitenessTier {
  return positionLevel === '会長' || positionLevel === '幹部' ? 'senior' : 'peer';
}
