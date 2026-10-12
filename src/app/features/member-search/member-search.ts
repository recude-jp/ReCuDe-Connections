import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { MemberSearchService, MemberWithId } from '../../core/services/member-search.service';
import { ConnectionService } from '../../core/services/connection.service';
import type { Connection, Member, ProfileField, Tenant } from '../../core/models/firestore.models';
import { MemberService } from '../../core/services/member.service';
import { MemberAvatar } from '../../shared/member-avatar/member-avatar';
import { fixedSearchOptions, formatProfileValue, visibleProfileFields } from '../../core/utils/profile-fields';
import { toErrorMessage } from '../../core/utils/errors';
import { ConnectTabs } from '../../shared/connect-tabs/connect-tabs';
import { canDiscover } from '../../core/utils/membership';
import type { QueryDocumentSnapshot } from '@angular/fire/firestore';

type ConnectionState =
  | { kind: 'none' }
  | { kind: 'pendingSent' }
  | { kind: 'pendingReceived'; connectionId: string }
  | { kind: 'accepted' };

@Component({
  selector: 'app-member-search',
  imports: [FormsModule, NgTemplateOutlet, ConnectTabs, MemberAvatar],
  templateUrl: './member-search.html',
  styleUrl: './member-search.scss',
})
export class MemberSearch {
  private readonly auth = inject(AuthService);
  private readonly searchService = inject(MemberSearchService);
  private readonly connectionService = inject(ConnectionService);
  private readonly memberService = inject(MemberService);

  private readonly tenant = toSignal(
    this.auth.session$.pipe(
      switchMap((session) => (session?.kind === 'member' ? this.memberService.getTenant(session.tenantId) : of(undefined))),
    ),
    { initialValue: undefined as Tenant | undefined },
  );

  /** 検索結果に出す項目と、検索の条件に使う項目(テナントのプロフィール項目で「会員検索の条件に使う」もの)。 */
  readonly fields = computed(() => visibleProfileFields(this.tenant()?.profileFields));
  readonly searchableFields = computed(() => this.fields().filter((field) => field.searchable));
  readonly formatValue = formatProfileValue;


  readonly session = toSignal(this.auth.session$, { initialValue: undefined });

  readonly memberSession = computed(() => {
    const session = this.session();
    return session?.kind === 'member' ? (session as MemberSession) : null;
  });

  readonly connections = toSignal(
    this.auth.session$.pipe(
      switchMap((session) =>
        session?.kind === 'member'
          ? this.connectionService.listMyConnections(session.tenantId, session.memberId)
          : of(undefined),
      ),
    ),
    { initialValue: undefined as (Connection & { id: string })[] | undefined },
  );

  /** 検索の条件にする項目のID(空 = すべて表示)。 */
  readonly category = signal('');
  readonly selectedField = computed<ProfileField | null>(
    () => this.searchableFields().find((field) => field.id === this.category()) ?? null,
  );
  readonly value = signal('');
  readonly valueOptions = signal<string[]>([]);
  /** 同じ連携コミュニティの、連携コミュニティだけのメンバー(検索結果の先頭に出す)。 */
  readonly communityResults = signal<MemberWithId[]>([]);
  /** 正規の会員(「もっと見る」で続きを足していく)。 */
  readonly results = signal<MemberWithId[] | null>(null);
  /** 正規の会員の続きを読む位置(null なら続きは無い)。 */
  private readonly cursor = signal<QueryDocumentSnapshot | null>(null);
  readonly hasMore = computed(() => this.cursor() !== null);
  readonly loading = signal(false);
  readonly loadingMore = signal(false);
  /** 検索したときの条件(「もっと見る」で同じ条件の続きを読む)。 */
  private lastQuery: { field: ProfileField | null; value: string } = { field: null, value: '' };
  readonly errorMessage = signal('');
  readonly requestingId = signal<string | null>(null);

  async onCategoryChange(category: string): Promise<void> {
    this.category.set(category);
    this.value.set('');
    const session = this.memberSession();
    const field = this.selectedField();
    if (!session || !field) {
      this.valueOptions.set([]);
      return;
    }
    // 選択式は選択肢、自動計算はコンバーターの結果の候補、自由入力・複数入力はこれまでの入力を候補にする。
    this.valueOptions.set(fixedSearchOptions(field) ?? (await this.searchService.getProfileOptions(session.tenantId, field.id)));
  }

  async search(): Promise<void> {
    const session = this.memberSession();
    if (!session) {
      return;
    }
    this.errorMessage.set('');
    this.loading.set(true);
    this.lastQuery = { field: this.selectedField(), value: this.value().trim() };
    const { field, value } = this.lastQuery;
    try {
      // 正規の会員と、同じ連携コミュニティの連携コミュニティだけのメンバー(ゲストは出さない)。
      const [page, community] = await Promise.all([
        this.searchService.searchFullMembers(session.tenantId, field, value),
        this.searchService.searchCommunityMembers(session.tenantId, session.communityIds, field, value),
      ]);
      this.communityResults.set(community.filter((m) => m.id !== session.memberId));
      this.results.set(page.members.filter((m) => m.id !== session.memberId));
      this.cursor.set(page.cursor);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** 正規の会員の続きを読む。 */
  async loadMore(): Promise<void> {
    const session = this.memberSession();
    const cursor = this.cursor();
    if (!session || !cursor) {
      return;
    }
    this.errorMessage.set('');
    this.loadingMore.set(true);
    try {
      const { field, value } = this.lastQuery;
      const page = await this.searchService.searchFullMembers(session.tenantId, field, value, cursor);
      this.results.update((list) => [...(list ?? []), ...page.members.filter((m) => m.id !== session.memberId)]);
      this.cursor.set(page.cursor);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loadingMore.set(false);
    }
  }

  /** この人にコネクト申請できるか(正規の会員どうしか、同じ連携コミュニティの人どうし)。 */
  canRequest(member: Member): boolean {
    const session = this.memberSession();
    return !!session && canDiscover({ membership: session.membership, communityIds: session.communityIds }, member);
  }

  connectionState(otherMemberId: string): ConnectionState {
    const session = this.memberSession();
    const list = this.connections();
    if (!session || !list) {
      return { kind: 'none' };
    }
    const found = list.find((c) => c.memberIds.includes(otherMemberId));
    if (!found || found.status === 'declined') {
      return { kind: 'none' };
    }
    if (found.status === 'accepted') {
      return { kind: 'accepted' };
    }
    return found.requestedBy === session.memberId
      ? { kind: 'pendingSent' }
      : { kind: 'pendingReceived', connectionId: found.id };
  }

  async sendRequest(toMemberId: string): Promise<void> {
    this.errorMessage.set('');
    this.requestingId.set(toMemberId);
    try {
      await this.connectionService.sendRequest(toMemberId);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.requestingId.set(null);
    }
  }

  /** 自分に届いているコネクト申請に答える(承認すると1対1のトークができる)。 */
  async respond(connectionId: string, memberId: string, accept: boolean): Promise<void> {
    this.errorMessage.set('');
    this.requestingId.set(memberId);
    try {
      await this.connectionService.respond(connectionId, accept);
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.requestingId.set(null);
    }
  }

  /** 検索結果に出す、入力されている項目。 */
  profileItems(member: Member): { label: string; value: string }[] {
    return this.fields()
      .filter((field) => !field.private)
      .map((field) => ({ label: field.label, value: formatProfileValue(member.profile?.[field.id], field) }))
      .filter((item) => item.value);
  }
}
