"""ReCuDe Connections 共通スタンプ「ルミ」生成スクリプト。
魔法のランプから飛び出す女の子。320x320 の SVG を作る。文字は M PLUS Rounded 1c (800)。"""
import json, math

INK = "#3a2c55"      # 線・文字（すみれ色の濃紺）
HAIR = "#4d3a7d"
HAIR_HI = "#7a64b3"
SKIN = "#ffe3d0"
OUTFIT = "#b79cf0"
SMOKE = "#efe7ff"
SMOKE2 = "#d9c9fb"
GOLD = "#f3c24f"
GOLD_D = "#d99b2b"
CHEEK = "#f7a39a"
RED = "#e2504a"
TEAL = "#43bfae"
WHITE = "#ffffff"

def sp(d, color, w, outline=INK):
    return (f'<path d="{d}" fill="none" stroke="{outline}" stroke-width="{w+10}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')

def arm(d, end):
    ex, ey = end
    return (sp(d, SKIN, 11) + f'<circle cx="{ex}" cy="{ey}" r="8" fill="{SKIN}" stroke="{INK}" stroke-width="4.5"/>')

def bangle(x, y):
    return f'<circle cx="{x}" cy="{y}" r="4" fill="{GOLD}" stroke="{INK}" stroke-width="2.5"/>'

def eyes(kind):
    out = ""
    for i, x in enumerate((-16, 16)):
        k = kind
        if kind == "wink":
            k = "normal" if i == 0 else "happy"
        if k == "happy":
            out += f'<path d="M{x-8},10 q8,-10 16,0" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>'
        elif k == "closed":
            out += f'<path d="M{x-8},6 q8,8 16,0" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>'
        else:
            big = k == "sparkle"
            out += f'<ellipse cx="{x}" cy="8" rx="{7.5 if big else 6.5}" ry="{10 if big else 8.5}" fill="{INK}"/>'
            out += f'<ellipse cx="{x}" cy="12" rx="{5 if big else 4}" ry="{4.5 if big else 3.5}" fill="{HAIR_HI}"/>'
            out += f'<circle cx="{x+2.5}" cy="4" r="{3.4 if big else 2.8}" fill="{WHITE}"/>'
            s = -1 if x < 0 else 1
            out += f'<path d="M{x+5*s},0 l{5*s},-4" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
    return out

def mouth(kind):
    if kind == "open":
        return (f'<path d="M-7,24 q7,11 14,0 z" fill="{INK}" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>'
                f'<path d="M-4,28 q4,-3 8,0 q-4,4 -8,0z" fill="{RED}"/>')
    if kind == "o":
        return f'<ellipse cx="0" cy="27" rx="4" ry="5" fill="{INK}"/>'
    return f'<path d="M-6,24 q6,6 12,0" fill="none" stroke="{INK}" stroke-width="4" stroke-linecap="round"/>'

def head(eye="normal", mo="smile"):
    return (
        # ポニーテール（頭の右上で結んで、右へ大きくはねる）
        f'<path d="M20,-60 C48,-80 84,-66 86,-30 C88,0 74,22 84,50 C62,44 52,22 52,0 C52,-22 42,-40 22,-44Z" '
        f'fill="{HAIR}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
        f'<path d="M44,-60 C66,-54 72,-30 68,-4 M58,-40 C62,-24 60,0 66,24" fill="none" stroke="{HAIR_HI}" stroke-width="3.5" stroke-linecap="round"/>'
        # 後ろ髪（短め）
        f'<path d="M-48,-2 C-52,-46 -26,-58 0,-58 C26,-58 52,-46 48,-2 C48,10 44,18 40,22 L-40,22 C-44,18 -48,10 -48,-2Z" fill="{HAIR}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
        # 顔
        f'<ellipse cx="0" cy="6" rx="40" ry="38" fill="{SKIN}" stroke="{INK}" stroke-width="5"/>'
        # 前髪
        f'<path d="M-42,2 C-44,-36 -18,-46 0,-44 C18,-46 44,-36 42,2 C34,-12 26,-16 18,-12 C12,-22 2,-24 -4,-16 C-14,-24 -30,-16 -42,2Z" fill="{HAIR}" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>'
        f'<path d="M-24,-32 q10,-6 20,-4" fill="none" stroke="{HAIR_HI}" stroke-width="4" stroke-linecap="round"/>'
        # 結び目のリボン
        f'<g transform="translate(26,-54) rotate(28)">'
        f'<path d="M0,0 l-17,-10 q-4,9 0,19z M0,0 l17,-10 q4,9 0,19z" fill="{OUTFIT}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>'
        f'<circle r="5" fill="{GOLD}" stroke="{INK}" stroke-width="3"/></g>'
        # 星のヘアピン（左側）
        + star(-30, -26, .55, GOLD)
        + "".join(f'<ellipse cx="{x}" cy="20" rx="8" ry="5" fill="{CHEEK}" opacity=".9"/>' for x in (-26, 26))
        + eyes(eye) + mouth(mo))

def torso():
    return (f'<path d="M-8,40 h16 v10 h-16z" fill="{SKIN}" stroke="{INK}" stroke-width="4"/>'
            f'<path d="M-30,56 C-24,46 24,46 30,56 L24,84 L-24,84Z" fill="{OUTFIT}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
            f'<path d="M-20,50 C-8,58 8,58 20,50" fill="none" stroke="{GOLD}" stroke-width="5" stroke-linecap="round"/>'
            f'<circle cx="0" cy="68" r="5" fill="{GOLD}" stroke="{INK}" stroke-width="3"/>')

def girl(x, y, s=.9, rot=0, eye="normal", mo="smile", back="", front=""):
    return (f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">'
            + back + torso() + head(eye, mo) + front + "</g>")

def lamp(x=0, y=0, s=1, lid=True):
    g = f'<g transform="translate({x},{y}) scale({s})">'
    g += sp("M52,206 C26,196 26,230 56,224", GOLD, 7)  # 取っ手
    g += f'<path d="M82,234 h36 l8,12 h-52z" fill="{GOLD_D}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
    g += (f'<path d="M50,210 C52,192 78,186 100,186 C124,186 142,194 150,204 L182,190 C190,186 194,192 188,196 L158,222 '
          f'C146,234 122,238 100,238 C74,238 50,228 50,210Z" fill="{GOLD}" stroke="{INK}" stroke-width="5.5" stroke-linejoin="round"/>')
    g += f'<path d="M64,214 C80,226 118,228 140,216" fill="none" stroke="{GOLD_D}" stroke-width="5" stroke-linecap="round"/>'
    g += f'<ellipse cx="78" cy="200" rx="10" ry="4.5" fill="{WHITE}" opacity=".6" transform="rotate(-12 78 200)"/>'
    if lid:
        g += (f'<ellipse cx="100" cy="187" rx="28" ry="7" fill="{GOLD_D}" stroke="{INK}" stroke-width="4.5"/>'
              f'<path d="M84,186 C86,172 114,172 116,186" fill="{GOLD}" stroke="{INK}" stroke-width="4.5"/>'
              f'<circle cx="100" cy="170" r="6" fill="{GOLD}" stroke="{INK}" stroke-width="4"/>')
    return g + "</g>"

SMOKE_STD = (f'<path d="M190,154 C184,170 168,172 172,186 C174,194 184,196 190,190 C198,182 210,186 218,176 C230,164 240,160 238,150Z" '
             f'fill="{SMOKE}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
             f'<path d="M192,176 c6,-6 14,-4 18,-10" fill="none" stroke="{SMOKE2}" stroke-width="5" stroke-linecap="round"/>'
             f'<circle cx="164" cy="170" r="8" fill="{SMOKE}" stroke="{INK}" stroke-width="4"/>'
             f'<circle cx="152" cy="154" r="5" fill="{SMOKE}" stroke="{INK}" stroke-width="3.5"/>')

def star(x, y, s=1, c=GOLD):
    pts = " ".join(f"{(20 if i%2==0 else 9)*math.sin(i*math.pi/5):.1f},{-(20 if i%2==0 else 9)*math.cos(i*math.pi/5):.1f}" for i in range(10))
    return (f'<polygon transform="translate({x},{y}) scale({s})" points="{pts}" fill="{c}" stroke="{INK}" '
            f'stroke-width="{3.5/s:.1f}" stroke-linejoin="round"/>')

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

def scene(inner, s=1.0):
    """2行の文言のときは全体を縮めて上に寄せる。"""
    if s == 1:
        return inner
    return f'<g transform="translate(160,8) scale({s}) translate(-160,-8)">{inner}</g>'

# ---- 構図づくりの道具 ----
def _rot(px, py, deg):
    r = math.radians(deg)
    return px * math.cos(r) - py * math.sin(r), px * math.sin(r) + py * math.cos(r)

def lamp2(cx, cy, s=1, rot=0, mirror=False, lid=True):
    """中心 (cx,cy) にランプを置く。回転・左右反転つき。"""
    sx = -s if mirror else s
    return (f'<g transform="translate({cx},{cy}) rotate({rot}) scale({sx},{s}) translate(-110,-212)">'
            + lamp(0, 0, 1, lid) + "</g>")

def spout(cx, cy, s=1, rot=0, mirror=False):
    px, py = (-80 if mirror else 80) * s, -20 * s
    dx, dy = _rot(px, py, rot)
    return cx + dx, cy + dy

def waist(gx, gy, s=.9, rot=0):
    dx, dy = _rot(0, 78 * s, rot)
    return gx + dx, gy + dy

def smoke(p0, c1, c2, p1, w1=36, w0=4, puffs=True):
    """ランプの口 p0 から女の子の腰 p1 へ、だんだん太くなるけむりの帯。"""
    n = 32
    pts, left, right = [], [], []
    for i in range(n + 1):
        t = i / n
        x = (1-t)**3*p0[0] + 3*(1-t)**2*t*c1[0] + 3*(1-t)*t**2*c2[0] + t**3*p1[0]
        y = (1-t)**3*p0[1] + 3*(1-t)**2*t*c1[1] + 3*(1-t)*t**2*c2[1] + t**3*p1[1]
        pts.append((x, y))
    for i, (x, y) in enumerate(pts):
        x0, y0 = pts[max(i-1, 0)]; x1, y1 = pts[min(i+1, n)]
        dx, dy = x1 - x0, y1 - y0; L = math.hypot(dx, dy) or 1
        nx, ny = -dy / L, dx / L
        t = i / n
        w = (w0 + (w1 - w0) * t**1.4) / 2 + 3 * math.sin(t * math.pi * 3)
        left.append((x + nx*w, y + ny*w)); right.append((x - nx*w, y - ny*w))
    poly = left + right[::-1]
    d = "M" + " L".join(f"{x:.1f},{y:.1f}" for x, y in poly) + "Z"
    out = f'<path d="{d}" fill="{SMOKE}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
    mid = " L".join(f"{x:.1f},{y:.1f}" for x, y in pts[8:26])
    out += f'<path d="M{mid}" fill="none" stroke="{SMOKE2}" stroke-width="5" stroke-linecap="round"/>'
    if puffs:
        for k, r in ((10, 7), (20, 5)):
            x, y = left[k]
            out += f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{r}" fill="{SMOKE}" stroke="{INK}" stroke-width="3.5"/>'
    return out

def burst(cx, cy, r1, r2, n=14, c="#fff1bf"):
    pts = []
    for i in range(n * 2):
        r = r2 if i % 2 == 0 else r1
        a = math.pi * i / n
        pts.append(f"{cx + r*math.cos(a):.1f},{cy + r*math.sin(a):.1f}")
    return f'<polygon points="{" ".join(pts)}" fill="{c}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'

def speedlines(cx, cy, r1, r2, n=22):
    out = f'<g stroke="{INK}" stroke-linecap="round">'
    for i in range(n):
        a = 2 * math.pi * i / n + 0.12
        if math.sin(a) > 0.35 or math.sin(a) < -0.72:
            continue
        w = 4 if i % 2 == 0 else 2.5
        rr = r1 + (8 if i % 3 == 0 else 0)
        out += (f'<path d="M{cx + rr*math.cos(a):.1f},{cy + rr*math.sin(a):.1f} '
                f'L{cx + r2*math.cos(a):.1f},{cy + r2*math.sin(a):.1f}" stroke-width="{w}"/>')
    return out + "</g>"

def cloudbank(y, x0=20, x1=300):
    out = ""
    x = x0
    i = 0
    while x <= x1:
        r = 26 if i % 2 == 0 else 20
        out += f'<circle cx="{x}" cy="{y + (0 if i % 2 == 0 else 8)}" r="{r}" fill="{SMOKE}" stroke="{INK}" stroke-width="4.5"/>'
        x += 34; i += 1
    return out + f'<rect x="{x0-8}" y="{y+2}" width="{x1-x0+16}" height="12" fill="{SMOKE}"/>'

ARM_REST_L = arm("M-26,58 C-38,66 -42,74 -40,82", (-40, 84))
ARM_WAVE_R = arm("M26,54 C44,40 52,20 54,0", (54, -4))
ARM_WAVE_L = arm("M-26,54 C-44,40 -52,20 -54,0", (-54, -4))

STAMPS = []
def stamp(sid, text, body):
    STAMPS.append({"id": sid, "text": text, "body": body})

# 1 はじめまして: ランプから斜めに「ぽんっ」と飛び出す（爆発の光を背負って）
L1 = dict(cx=78, cy=214, s=.72, rot=-28)
g1 = dict(gx=206, gy=96, s=1.0, rot=16)
p0 = spout(**L1); p1 = waist(g1["gx"], g1["gy"], g1["s"], g1["rot"])
stamp("hajimemashite", "はじめまして",
      burst(206, 112, 70, 104)
      + lamp2(**L1) + smoke(p0, (p0[0]+18, p0[1]-8), (p1[0]-30, p1[1]+26), p1, w1=40)
      + girl(g1["gx"], g1["gy"], s=g1["s"], rot=g1["rot"], eye="sparkle", mo="open", back=ARM_WAVE_R, front=ARM_REST_L)
      + sparkle(40, 60, 1.1) + sparkle(78, 110, .7, TEAL) + star(292, 226, .6) + sparkle(120, 30, .8, OUTFIT))

# 2 かしこまりました: 胸に手を当てて深くおじぎ（ランプは右、けむりは左へ流れる）
L2 = dict(cx=254, cy=218, s=.62, rot=12, mirror=True)
g2 = dict(gx=132, gy=104, s=.95, rot=-24)
p0 = spout(**L2); p1 = waist(g2["gx"], g2["gy"], g2["s"], g2["rot"])
bow_front = (arm("M-24,58 C-6,66 4,66 10,60", (12, 58)) + bangle(2, 64))
bow_back = arm("M26,56 C46,64 60,70 74,70", (78, 70))
stamp("kashikomari", "かしこまりました",
      lamp2(**L2) + smoke(p0, (p0[0]-10, p0[1]+20), (p1[0]+60, p1[1]+40), p1, w1=38)
      + girl(g2["gx"], g2["gy"], s=g2["s"], rot=g2["rot"], eye="closed", mo="smile", back=bow_back, front=bow_front)
      + sparkle(250, 60, 1) + sparkle(286, 110, .7, TEAL) + sparkle(210, 30, .6, OUTFIT))

# 3 おまかせください！: 集中線のアップ。こぶしを胸に、ウインク
fist = arm("M26,58 C18,70 8,72 2,66", (2, 64)) + bangle(12, 70)
thumb = arm("M-26,56 C-48,44 -58,24 -62,6", (-62, 2)) + f'<path d="M-62,-6 v-10" stroke="{INK}" stroke-width="11" stroke-linecap="round"/><path d="M-62,-6 v-10" stroke="{SKIN}" stroke-width="5" stroke-linecap="round"/>'
stamp("omakase", "おまかせください！",
      speedlines(166, 122, 110, 150, n=30)
      + girl(166, 116, s=1.42, rot=-4, eye="wink", mo="open", back=thumb, front=fist)
      + cloudbank(222, 24, 296)
      + lamp2(46, 200, .42, -20) + star(270, 58, .9) + sparkle(56, 70, .9, TEAL))

# 4 ありがとうございます: 長いS字のけむりにのって、右上からぺこり
L4 = dict(cx=62, cy=176, s=.62, rot=-8)
g4 = dict(gx=232, gy=72, s=.8, rot=-16)
p0 = spout(**L4); p1 = waist(g4["gx"], g4["gy"], g4["s"], g4["rot"])
thanks = sp("M-26,58 C-18,50 -8,40 -2,34", SKIN, 11) + sp("M26,58 C18,50 8,40 2,34", SKIN, 11) + f'<ellipse cx="0" cy="32" rx="8" ry="10" fill="{SKIN}" stroke="{INK}" stroke-width="4.5"/>'
stamp("arigatou", "ありがとう/ございます",
      lamp2(**L4) + smoke(p0, (p0[0]+70, p0[1]+10), (p1[0]-80, p1[1]+70), p1, w1=32)
      + girl(g4["gx"], g4["gy"], s=g4["s"], rot=g4["rot"], eye="happy", mo="open", front=thanks)
      + heart(130, 150, .9) + heart(160, 118, 1.1) + heart(118, 70, 1.4) + heart(290, 150, .8))

# 5 叶いますように: 真上へ高くのぼって祈る。流れ星が横切る
L5 = dict(cx=104, cy=214, s=.58, rot=-22)
g5 = dict(gx=178, gy=66, s=.72, rot=6)
p0 = spout(**L5); p1 = waist(g5["gx"], g5["gy"], g5["s"], g5["rot"])
pray = sp("M-26,58 C-18,54 -10,50 -4,48", SKIN, 11) + sp("M26,58 C18,54 10,50 4,48", SKIN, 11) + f'<ellipse cx="0" cy="46" rx="8" ry="10" fill="{SKIN}" stroke="{INK}" stroke-width="4.5"/>'
shoot = (f'<path d="M22,122 L88,70" stroke="{INK}" stroke-width="16" stroke-linecap="round"/>'
         f'<path d="M22,122 L88,70" stroke="#f7d97a" stroke-width="8" stroke-linecap="round"/>') + star(94, 64, 1.0)
stamp("kanaimasuyouni", "叶いますように",
      shoot + lamp2(**L5) + smoke(p0, (p0[0]+50, p0[1]-10), (p1[0]+40, p1[1]+50), p1, w1=30)
      + girl(g5["gx"], g5["gy"], s=g5["s"], rot=g5["rot"], eye="closed", mo="smile", front=pray)
      + star(272, 150, .6, "#f7d97a") + star(282, 40, .5) + sparkle(262, 214, .7, OUTFIT) + sparkle(40, 170, .7, TEAL))

# 6 おめでとうございます: ランプがクラッカーのように紙ふぶきを吹き出す
L6 = dict(cx=78, cy=160, s=.72, rot=-40)
sx, sy = spout(**L6)
streamers = ""
for i, (dx, dy, c) in enumerate(((84, -52, RED), (104, -12, TEAL), (52, -80, GOLD))):
    d = f"M{sx+6:.0f},{sy-4:.0f} c{dx*.25:.0f},{dy*.25-18:.0f} {dx*.35:.0f},{dy*.35+18:.0f} {dx*.5:.0f},{dy*.5:.0f} s{dx*.3:.0f},{dy*.3-18:.0f} {dx*.5:.0f},{dy*.5:.0f}"
    streamers += f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="9" stroke-linecap="round"/><path d="{d}" fill="none" stroke="{c}" stroke-width="4" stroke-linecap="round"/>'
confetti = "".join(f'<rect x="{x}" y="{y}" width="10" height="16" rx="2" fill="{c}" stroke="{INK}" stroke-width="2.5" transform="rotate({r} {x} {y})"/>'
                   for x, y, c, r in ((160, 40, RED, -20), (200, 20, TEAL, 20), (250, 50, GOLD, 30), (290, 90, OUTFIT, -15), (184, 150, RED, 25), (130, 90, GOLD, 40), (286, 170, TEAL, -30)))
stamp("omedetou", "おめでとう/ございます",
      streamers + confetti + lamp2(**L6)
      + girl(236, 96, s=.7, rot=22, eye="happy", mo="open", back=ARM_WAVE_R + ARM_WAVE_L)
      + smoke((sx, sy), (sx+40, sy+30), (200, 170), waist(236, 96, .7, 22), w1=26, puffs=False)
      + sparkle(40, 60, .9) + sparkle(120, 30, .7, TEAL))

# 7 少々お待ちください: ふたを持ち上げてのぞく
peek_girl = f'<g transform="translate(150,122) scale(.9)">' + head("normal", "o") + "</g>"
bl = lamp(1.5, -101, 1.35, lid=False)
lid = (f'<g transform="translate(224,62) rotate(28)"><ellipse cx="0" cy="12" rx="34" ry="9" fill="{GOLD_D}" stroke="{INK}" stroke-width="5"/>'
       f'<path d="M-20,12 C-18,-6 18,-6 20,12" fill="{GOLD}" stroke="{INK}" stroke-width="5"/>'
       f'<circle cx="0" cy="-8" r="7" fill="{GOLD}" stroke="{INK}" stroke-width="4.5"/></g>')
hands = "".join(f'<circle cx="{x}" cy="150" r="9" fill="{SKIN}" stroke="{INK}" stroke-width="4.5"/>' for x in (124, 176))
stamp("shoushou", "少々お待ちください", peek_girl + bl + hands + lid
      + f'<g fill="{INK}"><circle cx="232" cy="130" r="5"/><circle cx="252" cy="130" r="5"/><circle cx="272" cy="130" r="5"/></g>')

# 8 またね！: 大きなランプのうずに吸いこまれながら手をふる
L8 = dict(cx=150, cy=200, s=1.0, rot=0)
p0 = spout(**L8)
vortex = ""
for i, r in enumerate((58, 42, 26)):
    vortex += (f'<ellipse cx="{p0[0]+40}" cy="{p0[1]-58}" rx="{r}" ry="{r*.55:.0f}" fill="none" stroke="{INK}" stroke-width="{12-i*2}" '
               f'stroke-dasharray="{r*2.2:.0f} {r*.8:.0f}" transform="rotate(-18 {p0[0]+40} {p0[1]-58})"/>'
               f'<ellipse cx="{p0[0]+40}" cy="{p0[1]-58}" rx="{r}" ry="{r*.55:.0f}" fill="none" stroke="{SMOKE}" stroke-width="{5-i}" '
               f'stroke-dasharray="{r*2.2:.0f} {r*.8:.0f}" transform="rotate(-18 {p0[0]+40} {p0[1]-58})"/>')
g8 = dict(gx=226, gy=60, s=.5, rot=-30)
stamp("matane", "またね！",
      vortex + lamp2(**L8) + smoke(p0, (p0[0]+4, p0[1]-30), (waist(**g8)[0]-10, waist(**g8)[1]+30), waist(**g8), w1=20)
      + girl(g8["gx"], g8["gy"], s=g8["s"], rot=g8["rot"], eye="happy", mo="open", back=ARM_WAVE_R, front=ARM_REST_L)
      + f'<g stroke="{INK}" stroke-width="5" stroke-linecap="round"><path d="M270,30 l10,-8"/><path d="M280,50 l14,-2"/></g>'
      + sparkle(40, 80, 1, TEAL) + sparkle(80, 40, .7) + sparkle(290, 150, .7, OUTFIT))

def svg(st, uid):
    f = (f'<defs><filter id="ol{uid}" x="-5%" y="-5%" width="110%" height="110%">'
         f'<feMorphology in="SourceAlpha" operator="dilate" radius="7" result="d"/>'
         f'<feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/>'
         f'<feMerge><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">{f}'
            f'<g filter="url(#ol{uid})">{st["body"]}{label(st["text"])}</g></svg>')

if __name__ == "__main__":
    json.dump([{"id": s["id"], "text": s["text"], "svg": svg(s, f"l{i}")} for i, s in enumerate(STAMPS)],
              open("lumi.json", "w"), ensure_ascii=False)
    print(len(STAMPS))
