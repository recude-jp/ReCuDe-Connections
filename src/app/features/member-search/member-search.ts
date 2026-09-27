import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap, of } from 'rxjs';
import { AuthService, MemberSession } from '../../core/services/auth.service';
import { MemberSearchService } from '../../core/services/member-search.service';
import { ConnectionService } from '../../core/services/connection.service';
import type { Connection, Member, ProfileField, Tenant } from '../../core/models/firestore.models';
import { MemberService } from '../../core/services/member.service';
import { MemberAvatar } from '../../shared/member-avatar/member-avatar';
import { fixedSearchOptions, formatProfileValue, visibleProfileFields } from '../../core/utils/profile-fields';
import { toErrorMessage } from '../../core/utils/errors';
import { ConnectTabs } from '../../shared/connect-tabs/connect-tabs';
import { isFullMember } from '../../core/utils/membership';


type ConnectionState =
  | { kind: 'none' }
  | { kind: 'pendingSent' }
  | { kind: 'pendingReceived'; connectionId: string }
  | { kind: 'accepted' };

@Component({
  selector: 'app-member-search',
  imports: [FormsModule, ConnectTabs, MemberAvatar],
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

  /** ゲストは会員を見られるが、コネクト申請はできない。 */
  readonly isGuest = computed(() => !!this.memberSession()?.isGuest);

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
  readonly results = signal<(Member & { id: string })[] | null>(null);
  readonly loading = signal(false);
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
    try {
      const found = await this.searchService.searchMembers(session.tenantId, this.selectedField(), this.value().trim());
      // ゲスト(まだ正規の会員でない人)は検索結果に出さない。
      this.results.set(
        found.filter((m) => m.id !== session.memberId && m.isActive && isFullMember(m)),
      );
    } catch (err) {
      this.errorMessage.set(toErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
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
