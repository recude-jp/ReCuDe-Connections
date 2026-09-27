import { AfterViewInit, Component, ElementRef, effect, input, output, signal, viewChildren } from '@angular/core';

/**
 * 6桁PIN用の1桁ずつの入力欄。1文字入力すると次の欄へ自動的にフォーカスが移り、
 * 全欄が埋まったら completed を発火する(呼び出し側でログイン/検証処理を開始する)。
 */
@Component({
  selector: 'app-pin-input',
  standalone: true,
  templateUrl: './pin-input.html',
  styleUrl: './pin-input.scss',
})
export class PinInput implements AfterViewInit {
  readonly length = input(6);
  readonly disabled = input(false);
  readonly value = input('');
  readonly autoFocus = input(true);

  readonly valueChange = output<string>();
  readonly completed = output<string>();

  protected readonly digits = signal<string[]>([]);

  private readonly digitInputs = viewChildren<ElementRef<HTMLInputElement>>('digitInput');
  /** nullにしておくことで、valueの初期値が空文字でも初回のeffectが必ず実行され、length()どおりに初期化される。 */
  private lastEmitted: string | null = null;

  constructor() {
    effect(() => {
      const external = this.value();
      if (external !== this.lastEmitted) {
        this.lastEmitted = external;
        this.digits.set(Array.from({ length: this.length() }, (_, i) => external[i] ?? ''));
      }
    });
  }

  ngAfterViewInit(): void {
    if (this.autoFocus()) {
      this.focusInput(0);
    }
  }

  onDigitInput(index: number, event: Event): void {
    const target = event.target as HTMLInputElement;
    const digit = target.value.replace(/\D/g, '').slice(-1);
    target.value = digit;

    const next = this.digits().slice();
    next[index] = digit;
    this.digits.set(next);
    this.emit(next);

    if (digit && index < this.length() - 1) {
      this.focusInput(index + 1);
    }

    if (digit && index === this.length() - 1 && next.every((d) => d !== '')) {
      this.completed.emit(next.join(''));
    }
  }

  onKeydown(index: number, event: KeyboardEvent): void {
    if (event.key === 'Backspace' && !this.digits()[index] && index > 0) {
      this.focusInput(index - 1);
    }
  }

  private emit(next: string[]): void {
    const joined = next.join('');
    this.lastEmitted = joined;
    this.valueChange.emit(joined);
  }

  private focusInput(index: number): void {
    const el = this.digitInputs()[index]?.nativeElement;
    el?.focus();
    el?.select();
  }
}
