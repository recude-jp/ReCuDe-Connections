"""ReCuDe Connections 共通スタンプ「ルカ」生成スクリプト。
仲間を増やしていくイルカ。文言は「ゆい」と同じ8種。320x320 の SVG を作る。文字は M PLUS Rounded 1c (800)。"""
import json

INK = "#1c3a5e"      # 線・文字（深い海の紺）
BODY = "#8fcdea"     # ルカ
BELLY = "#f2fbfe"
SHADE = "#72b3d6"
FRIEND_SHADE = "#e98aa2"
FRIEND = "#f7a3b8"   # なかま（さんご色）
FRIEND_BELLY = "#fff0f3"
CHEEK = "#f59c93"
WATER = "#bfe8f7"
WATER_D = "#7cc9ea"
GOLD = "#f3c24f"
RED = "#e2504a"
WHITE = "#ffffff"

def sp(d, color, w, outline=INK):
    return (f'<path d="{d}" fill="none" stroke="{outline}" stroke-width="{w+10}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')

EX, EY = 44, -68   # 目の位置

def eye(kind):
    x, y = EX, EY
    if kind == "happy":
        return f'<path d="M{x-10},{y+3} q10,-12 20,0" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
    if kind == "closed":
        return f'<path d="M{x-10},{y-2} q10,10 20,0" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
    if kind == "calm":
        return f'<path d="M{x-10},{y} q10,4 20,0" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
    big = kind == "sparkle"
    return (f'<ellipse cx="{x}" cy="{y}" rx="{8.5 if big else 7.5}" ry="{11 if big else 10}" fill="{INK}"/>'
            f'<circle cx="{x+3}" cy="{y-5}" r="{3.8 if big else 3.2}" fill="{WHITE}"/>'
            + (f'<circle cx="{x-3}" cy="{y+5}" r="1.8" fill="{WHITE}"/>' if big else ""))

def mouth(kind):
    if kind == "open":
        return (f'<path d="M101,-48 C94,-34 74,-34 68,-47 Z" fill="{INK}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'
                f'<path d="M76,-40 q8,-3 14,1 q-8,5 -14,-1z" fill="{RED}"/>')
    return f'<path d="M102,-48 C92,-42 78,-42 68,-48" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>'

FIN_BASE = (16, -27)   # 胸びれの付け根（のど元のからだの縁）
FIN = ("M-12,-6 C-4,-12 10,-10 15,-2 C22,10 22,28 14,44 C12,46 9,46 8,43 "
       "C6,30 0,18 -10,10 C-16,4 -16,-2 -12,-6Z")

def fin_g(angle, inner):
    """胸びれ。angle 0 で下にたれる。マイナスで顔の向きへ持ち上がる。"""
    return f'<g transform="translate({FIN_BASE[0]},{FIN_BASE[1]}) rotate({angle})">{inner}</g>'

def dolphin(x, y, s=1.0, rot=0, color=BODY, belly=BELLY, eye_k="normal", mo="smile", fl=0,
            mirror=False, extra=""):
    """ジャンプ姿勢のイルカ（右向き）。原点はからだの中心、頭が右上、尾びれが下。"""
    sx = -s if mirror else s
    shade = SHADE if color == BODY else FRIEND_SHADE
    g = [f'<g transform="translate({x},{y}) rotate({rot}) scale({sx},{s})">']
    # 尾びれ・背びれ・からだを1つのシルエットとして描く。
    # 先に3つの輪郭線（太め）をまとめて描き、その上に塗りを重ねて、つなぎ目の線を消す。
    fluke = ("M-34,68 C-26,80 -8,82 20,78 C12,92 -8,98 -22,96 C-30,106 -42,118 -56,124 "
             "C-54,108 -50,92 -46,76Z")
    dorsal = "M-14,-108 C-36,-120 -68,-120 -92,-106 C-76,-98 -66,-86 -62,-72Z"
    body = ("M104,-50 C106,-58 96,-64 82,-66 C82,-98 66,-116 40,-118 C14,-120 -14,-114 -36,-100 "
            "C-60,-84 -74,-58 -76,-26 C-78,8 -66,44 -46,72 L-36,82 L-22,78 "
            "C-14,52 -10,22 -4,-2 C4,-22 20,-30 38,-32 C60,-34 84,-38 96,-42 C102,-44 104,-47 104,-50Z")
    for d in (fluke, dorsal, body):
        g.append(f'<path d="{d}" fill="{INK}" stroke="{INK}" stroke-width="11" stroke-linejoin="round"/>')
    g.append(fin_g(fl, f'<path d="{FIN}" fill="{INK}" stroke="{INK}" stroke-width="10" stroke-linejoin="round"/>'))
    for d in (fluke, dorsal, body):
        g.append(f'<path d="{d}" fill="{color}"/>')
    g.append(f'<path d="M-30,84 C-24,88 -12,88 0,86" fill="none" stroke="{shade}" stroke-width="4" stroke-linecap="round"/>')
    # 背中側の影
    g.append(f'<path d="M-62,-60 C-72,-30 -70,10 -56,46" fill="none" stroke="{shade}" stroke-width="7" stroke-linecap="round"/>')
    # おなか（あごから尾の付け根まで白い帯）
    g.append(f'<path d="M100,-45 C84,-38 60,-34 38,-31 C20,-29 4,-20 -3,-2 C-9,20 -13,50 -21,76 '
             f'C-30,50 -28,20 -20,-4 C-10,-30 14,-42 42,-45 C66,-47 88,-47 100,-45Z" fill="{belly}"/>')
    g.append(f'<ellipse cx="18" cy="-100" rx="16" ry="6" fill="{WHITE}" opacity=".55" transform="rotate(-8 18 -100)"/>')
    g.append(f'<ellipse cx="30" cy="-50" rx="10" ry="6" fill="{CHEEK}" opacity=".9"/>')
    # 胸びれ（からだとつながって見えるよう、付け根には線を入れない）
    g.append(fin_g(fl, f'<path d="{FIN}" fill="{color}"/>'
                       f'<path d="M-4,-4 C8,-4 16,8 17,24" fill="none" stroke="{shade}" stroke-width="4" stroke-linecap="round"/>'
                       f'<path d="M-8,4 C0,12 6,26 9,38" fill="none" stroke="{WHITE}" stroke-width="3" stroke-linecap="round" opacity=".6"/>'))
    g.append(eye(eye_k) + mouth(mo))
    g.append(extra + "</g>")
    return "".join(g)

def waves(y, x0=24, x1=296, fill=WATER):
    d = f"M{x0},{y}"
    x = x0
    while x < x1:
        d += f" q17,-12 34,0"
        x += 34
    d += f" V{y+18} H{x0}Z"
    return f'<path d="{d}" fill="{fill}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'

def splash(x, y, s=1):
    return (f'<g transform="translate({x},{y}) scale({s})" fill="{WATER}" stroke="{INK}" stroke-width="4" stroke-linejoin="round">'
            f'<path d="M-6,0 C-10,-14 -20,-22 -26,-26 C-22,-12 -18,-4 -14,2Z"/>'
            f'<path d="M0,0 C0,-18 4,-30 8,-38 C12,-26 10,-10 6,2Z"/>'
            f'<path d="M12,2 C18,-8 28,-14 34,-16 C30,-6 24,2 18,6Z"/>'
            f'<circle cx="-30" cy="-38" r="5"/><circle cx="22" cy="-40" r="4"/></g>')

def bubble(x, y, r):
    return (f'<circle cx="{x}" cy="{y}" r="{r}" fill="{WATER}" fill-opacity=".6" stroke="{INK}" stroke-width="3.5"/>'
            f'<circle cx="{x-r*.35:.1f}" cy="{y-r*.35:.1f}" r="{max(r*.25,1.5):.1f}" fill="{WHITE}"/>')

def sparkle(x, y, s=1, c=GOLD):
    return (f'<path transform="translate({x},{y}) scale({s})" d="M0,-12 Q2,-2 12,0 Q2,2 0,12 Q-2,2 -12,0 Q-2,-2 0,-12Z" '
            f'fill="{c}" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>')

def heart(x, y, s=1, c=RED):
    return (f'<path transform="translate({x},{y}) scale({s})" d="M0,6 C-14,-4 -10,-16 0,-9 C10,-16 14,-4 0,6Z" '
            f'fill="{c}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>')

def label(text, y=292):
    lines = text.split("/")
    size = min(44 if len(lines) == 1 else 40, int(278 / max(len(l) for l in lines)))
    ys = [y] if len(lines) == 1 else [y - size - 2, y]
    return "".join(f'<text x="160" y="{yy}" text-anchor="middle" font-family="\'M PLUS Rounded 1c\', sans-serif" '
                   f'font-weight="800" font-size="{size}" fill="{INK}">{l}</text>' for l, yy in zip(lines, ys))

STAMPS = []
def stamp(sid, text, body):
    STAMPS.append({"id": sid, "text": text, "body": body})

# 1 はじめまして: 水面からジャンプして胸びれをふる
drops = (f'<path d="M92,208 q-10,-14 -4,-24 q10,12 4,24z" fill="{WATER}" stroke="{INK}" stroke-width="3.5"/>'
         f'<path d="M228,210 q10,-14 4,-24 q-10,12 -4,24z" fill="{WATER}" stroke="{INK}" stroke-width="3.5"/>')
stamp("hajimemashite", "はじめまして", waves(222) + drops
      + dolphin(160, 112, s=.82, rot=-4, eye_k="sparkle", mo="open", fl=-40)
      + sparkle(52, 62, 1) + sparkle(270, 40, .8, FRIEND))

# 2 よろしくお願いします: 頭を下げておじぎ
stamp("yoroshiku", "よろしく/お願いします", dolphin(156, 110, s=.72, rot=30, eye_k="closed", mo="smile", fl=-20)
      + bubble(278, 150, 9) + bubble(290, 124, 5) + sparkle(56, 52, .9))

# 3 ありがとうございます: にっこり、ハート
stamp("arigatou", "ありがとう/ございます", dolphin(150, 110, s=.72, rot=-8, eye_k="happy", mo="open", fl=-30)
      + heart(262, 44, 1.3) + heart(290, 90, .9) + heart(228, 16, .8) + bubble(56, 150, 8) + bubble(44, 124, 5))

# 4 了解です！: バブルリングで「まる」
ring = (f'<ellipse cx="238" cy="92" rx="50" ry="48" fill="none" stroke="{INK}" stroke-width="22"/>'
        f'<ellipse cx="238" cy="92" rx="50" ry="48" fill="none" stroke="{WATER}" stroke-width="12"/>'
        f'<path d="M208,60 q16,-12 36,-10" fill="none" stroke="{WHITE}" stroke-width="5" stroke-linecap="round"/>')
stamp("ryoukai", "了解です！", ring + dolphin(110, 130, s=.8, rot=-6, eye_k="happy", mo="open", fl=-40)
      + bubble(190, 150, 6) + bubble(178, 168, 4))

# 5 ご紹介します: 仲間を胸びれで示す
stamp("goshoukai", "ご紹介します", waves(226)
      + dolphin(104, 128, s=.7, rot=-2, eye_k="normal", mo="open", fl=-50)
      + dolphin(248, 150, s=.5, rot=6, color=FRIEND, belly=FRIEND_BELLY, eye_k="sparkle", mo="smile", fl=-20, mirror=True)
      + sparkle(262, 52, .9) + sparkle(292, 90, .6, BODY))

# 6 参加します！: 大ジャンプ
arc = f'<path d="M40,214 C50,150 90,96 136,80" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round" stroke-dasharray="2 14"/>'
stamp("sanka", "参加します！", waves(226) + arc + splash(62, 226, 1.1)
      + dolphin(190, 118, s=.8, rot=36, eye_k="sparkle", mo="open", fl=-40) + sparkle(290, 40, .9) + sparkle(96, 40, .7, FRIEND))

# 7 おつかれさまです: 波にぷかぷか、頭にタオル
towel = (f'<path d="M4,-112 C22,-130 62,-126 74,-100 L66,-92 C54,-114 24,-118 8,-102Z" fill="{WHITE}" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>'
         f'<path d="M24,-120 v8 M40,-120 v8 M56,-114 v8" stroke="{WATER_D}" stroke-width="3" stroke-linecap="round"/>')
steam = "".join(f'<path d="M{x},96 c-8,-8 8,-14 0,-24 c-6,-8 4,-12 2,-18" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round" opacity=".5"/>' for x in (60, 272))
stamp("otsukare", "おつかれ/さまです", steam + dolphin(160, 112, s=.8, rot=-6, eye_k="calm", mo="smile", fl=-30, extra=towel)
      + waves(190, 30, 290))

# 8 つながりましょう: 2頭で向かい合ってハートの形にジャンプ
stamp("tsunagari", "つながり/ましょう", waves(186, 30, 290)
      + dolphin(98, 110, s=.6, rot=-10, eye_k="happy", mo="open", fl=-30)
      + dolphin(222, 110, s=.6, rot=-10, color=FRIEND, belly=FRIEND_BELLY, eye_k="happy", mo="open", fl=-30, mirror=True)
      + heart(160, 26, 1.5) + bubble(160, 150, 6) + bubble(150, 168, 4))

def svg(st, uid):
    f = (f'<defs><filter id="ol{uid}" x="-5%" y="-5%" width="110%" height="110%">'
         f'<feMorphology in="SourceAlpha" operator="dilate" radius="7" result="d"/>'
         f'<feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/>'
         f'<feMerge><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">{f}'
            f'<g filter="url(#ol{uid})">{st["body"]}{label(st["text"])}</g></svg>')

if __name__ == "__main__":
    json.dump([{"id": s["id"], "text": s["text"], "svg": svg(s, f"r{i}")} for i, s in enumerate(STAMPS)],
              open("luka.json", "w"), ensure_ascii=False)
    print(len(STAMPS))
