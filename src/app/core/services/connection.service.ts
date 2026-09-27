import { Injectable, inject } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore, collection, collectionData, doc, docData, query, where } from '@angular/fire/firestore';
import { Observable } from 'rxjs';
import type { Connection } from '../models/firestore.models';

/** 会員エリアのルート(member.routes.ts)で提供する(Firestore SDKを初回読み込みに含めないため)。 */
@Injectable()
export class ConnectionService {
  private readonly functions = inject(Functions);
  private readonly firestore = inject(Firestore);

  getConnection(tenantId: string, connectionId: string): Observable<Connection | undefined> {
    const ref = doc(this.firestore, `tenants/${tenantId}/connections/${connectionId}`);
    return docData(ref) as Observable<Connection | undefined>;
  }

  async sendRequest(toMemberId: string): Promise<{ connectionId: string }> {
    const fn = httpsCallable<{ toMemberId: string }, { connectionId: string }>(
      this.functions,
      'sendConnectionRequest',
    );
    const result = await fn({ toMemberId });
    return result.data;
  }

  async respond(connectionId: string, accept: boolean): Promise<{ status: 'accepted' | 'declined' }> {
    const fn = httpsCallable<
      { connectionId: string; accept: boolean },
      { status: 'accepted' | 'declined' }
    >(this.functions, 'respondToConnectionRequest');
    const result = await fn({ connectionId, accept });
    return result.data;
  }

  /** 自分が当事者(送信・受信いずれか)のコネクションを全件取得する。 */
  listMyConnections(tenantId: string, memberId: string): Observable<(Connection & { id: string })[]> {
    const connectionsRef = collection(this.firestore, `tenants/${tenantId}/connections`);
    const connectionsQuery = query(connectionsRef, where('memberIds', 'array-contains', memberId));
    return collectionData(connectionsQuery, { idField: 'id' }) as Observable<
      (Connection & { id: string })[]
    >;
  }
}
