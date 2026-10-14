import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import type { Connection, GroupInvitationNotice } from './models';
import { displayNameOf, pushSecrets, sendPushToMember } from './push';

/** Firestore のトリガーは、データベースと同じリージョンに置く(onRoomMessageCreated と同じ)。 */
const TRIGGER_OPTIONS = { region: 'asia-northeast1', secrets: pushSecrets } as const;

/** グループに招待されたら、招待された人に知らせる。 */
export const onGroupInvitationCreated = onDocumentCreated(
  { ...TRIGGER_OPTIONS, document: 'tenants/{tenantId}/members/{memberId}/groupInvitations/{roomId}' },
  async (event) => {
    const notice = event.data?.data() as GroupInvitationNotice | undefined;
    if (!notice) {
      return;
    }
    const { tenantId, memberId, roomId } = event.params;
    await sendPushToMember(tenantId, memberId, {
      title: notice.roomName || 'グループ',
      body: `${notice.invitedByName}さんからグループに招待されました`,
      url: '/talk',
      tag: `group-invitation-${roomId}`,
    });
  },
);

/**
 * コネクトの通知。申請が届いたら相手に、承認されたら申請した人に知らせる。
 * 招待から参加したとき(最初からつながった状態で作られる)は、招待した人に知らせる。
 */
export const onConnectionWritten = onDocumentWritten(
  { ...TRIGGER_OPTIONS, document: 'tenants/{tenantId}/connections/{connectionId}' },
  async (event) => {
    const before = event.data?.before.data() as Connection | undefined;
    const after = event.data?.after.data() as Connection | undefined;
    if (!after) {
      return;
    }
    const { tenantId, connectionId } = event.params;
    const other = after.memberIds.find((id) => id !== after.requestedBy);
    if (!other) {
      return;
    }
    const tag = `connection-${connectionId}`;

    if (!before && after.status === 'pending') {
      const name = await displayNameOf(tenantId, after.requestedBy);
      await sendPushToMember(tenantId, other, {
        title: 'コネクト申請',
        body: `${name}さんからコネクト申請が届きました`,
        url: '/connect',
        tag,
      });
    } else if (before?.status === 'pending' && after.status === 'accepted') {
      const name = await displayNameOf(tenantId, other);
      await sendPushToMember(tenantId, after.requestedBy, {
        title: 'コネクト',
        body: `${name}さんがコネクト申請を承認しました`,
        url: '/talk',
        tag,
      });
    } else if (!before && after.status === 'accepted') {
      const name = await displayNameOf(tenantId, other);
      await sendPushToMember(tenantId, after.requestedBy, {
        title: 'コネクト',
        body: `${name}さんが招待から参加しました`,
        url: '/talk',
        tag,
      });
    }
  },
);
