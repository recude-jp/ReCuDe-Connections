import { Component, computed, input, output } from '@angular/core';

/**
 * メッセージに付いているリアクションの集計(多い順)。押した絵文字を react で親に伝える(自分と同じものなら取り消し。1人1つ)。
 * リアクションの選択肢は、リアクションのボタンの横に ReactionPicker で出す。
 */
@Component({
  selector: 'app-message-reactions',
  templateUrl: './message-reactions.html',
  styleUrl: './message-reactions.scss',
})
export class MessageReactions {
  /** 会員ID → 絵文字。 */
  readonly reactions = input.required<Record<string, string>>();
  readonly myMemberId = input.required<string>();
  readonly memberNames = input.required<Map<string, string>>();
  readonly react = output<string>();

  readonly mine = computed(() => this.reactions()[this.myMemberId()]);

  readonly summary = computed(() => {
    const byEmoji = new Map<string, string[]>();
    for (const [memberId, emoji] of Object.entries(this.reactions())) {
      byEmoji.set(emoji, [...(byEmoji.get(emoji) ?? []), memberId]);
    }
    return [...byEmoji.entries()]
      .map(([emoji, ids]) => ({
        emoji,
        count: ids.length,
        names: ids.map((id) => this.memberNames().get(id) ?? '退出したメンバー').join('、'),
      }))
      .sort((a, b) => b.count - a.count);
  });
}
