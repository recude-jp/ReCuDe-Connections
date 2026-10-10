import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';

export interface InviteRequestInput {
  tenantId: string;
  name: string;
  phoneNumber: string;
  email: string;
  hometown: string;
  highSchool: string;
  juniorHighSchool: string;
  kenjinkaiMember: boolean;
  alumniMember: boolean;
  alumniCommunityId: string;
  alumniOtherName: string;
  referrer: string;
  note: string;
  agreed: boolean;
}

/** 招待申請の公開フォーム(/request)。ログイン前に使うため、Firestore ではなく Cloud Functions だけを呼ぶ。 */
@Injectable({ providedIn: 'root' })
export class InviteRequestService {
  private readonly functions = inject(Functions);

  /** 在京同窓会(連携コミュニティ)の選択肢。 */
  async getCommunities(tenantId: string): Promise<{ id: string; name: string }[]> {
    const fn = httpsCallable<{ tenantId: string }, { communities: { id: string; name: string }[] }>(
      this.functions,
      'getInviteRequestOptions',
    );
    return (await fn({ tenantId })).data.communities;
  }

  async submit(input: InviteRequestInput): Promise<void> {
    const fn = httpsCallable<InviteRequestInput, { received: boolean }>(this.functions, 'submitInviteRequest');
    await fn(input);
  }
}
