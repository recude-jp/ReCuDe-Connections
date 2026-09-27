"""ReCuDe Connections 共通スタンプ「こまめ」生成スクリプト。
サラブレッドを目指す子馬。320x320 の SVG を作る。文字は M PLUS Rounded 1c (800)。"""
import json

INK = "#3d2619"     # 線・文字（こげ茶）
COAT = "#c98952"    # 毛色（鹿毛寄りの栗色）
MUZZLE = "#f4dcc1"  # 鼻まわり
MANE = "#5c3522"    # たてがみ・しっぽ
HOOF = "#4a3a33"
CHEEK = "#f39a8e"
EAR_IN = "#f2b3a3"
RED = "#e2504a"
GOLD = "#f3c24f"
TEAL = "#43bfae"
WHITE = "#ffffff"

def stroke_path(d, color, w, outline=INK):
    return (f'<path d="{d}" fill="none" stroke="{outline}" stroke-width="{w+10}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{color}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')

def leg(d, end, hoof_rot=0):
    ex, ey = end
    return (stroke_path(d, COAT, 14) +
            f'<ellipse cx="{ex}" cy="{ey}" rx="10" ry="6.5" fill="{HOOF}" stroke="{INK}" stroke-width="4" transform="rotate({hoof_rot} {ex} {ey})"/>')

LEGS_STAND = {
    "back": leg("M-42,108 L-44,136", (-44, 140)) + leg("M42,108 L44,136", (44, 140)),
    "front": leg("M-22,112 L-22,144", (-22, 148)) + leg("M22,112 L22,144", (22, 148)),
}

def eyes(kind):
    out = ""
    for x in (-36, 36):
        if kind == "happy":
            out += f'<path d="M{x-10},-16 q10,-12 20,0" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
        elif kind == "closed":
            out += f'<path d="M{x-10},-20 q10,10 20,0" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
        elif kind == "calm":
            out += f'<path d="M{x-10},-18 q10,4 20,0" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>'
        else:
            big = kind in ("sparkle", "fire")
            out += f'<ellipse cx="{x}" cy="-18" rx="{9 if big else 8}" ry="{12 if big else 11}" fill="{INK}"/>'
            out += f'<circle cx="{x+3}" cy="-23" r="{4 if big else 3.2}" fill="{WHITE}"/>'
            if big:
                out += f'<circle cx="{x-3}" cy="-12" r="1.8" fill="{WHITE}"/>'
    if kind == "fire":  # きりっと眉
        out += "".join(f'<path d="M{x-12*s},-40 l{24*s},8" stroke="{INK}" stroke-width="5" stroke-linecap="round"/>' for x, s in ((-36, 1), (36, -1)))
    return out

def mouth(kind):
    if kind == "open":
        return (f'<path d="M-12,56 q12,16 24,0 z" fill="{INK}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>'
                f'<path d="M-6,62 q6,-4 12,0 q-6,5 -12,0z" fill="{RED}"/>')
    if kind == "none":
        return ""
    return f'<path d="M-10,56 q10,9 20,0" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>'

def head(eye="normal", mo="smile", ear="up", extra_front=""):
    er = {"up": 0, "back": 18, "perk": -8}[ear]
    ears = ""
    for s in (-1, 1):
        ears += (f'<g transform="rotate({-er*s} {-40*s} -84)">'
                 f'<path d="M{-36*s},-84 C{-58*s},-100 {-62*s},-128 {-54*s},-144 C{-36*s},-132 {-22*s},-110 {-22*s},-94Z" '
                 f'fill="{COAT}" stroke="{INK}" stroke-width="5" stroke-linejoin="round"/>'
                 f'<path d="M{-38*s},-92 C{-50*s},-104 {-52*s},-120 {-50*s},-130 C{-40*s},-120 {-32*s},-108 {-30*s},-98Z" fill="{EAR_IN}"/></g>')
    return (ears +
            f'<path d="M0,-98 C46,-98 72,-68 72,-30 C72,4 56,20 52,38 C48,62 28,74 0,74 C-28,74 -48,62 -52,38 C-56,20 -72,4 -72,-30 C-72,-68 -46,-98 0,-98Z" '
            f'fill="{COAT}" stroke="{INK}" stroke-width="5.5" stroke-linejoin="round"/>'
            f'<ellipse cx="0" cy="44" rx="44" ry="30" fill="{MUZZLE}"/>'
            f'<path d="M0,-64 l7,10 l-7,10 l-7,-10z" fill="{WHITE}"/>'  # 流星（ほし）
            f'<path d="M-24,-92 C-20,-112 -4,-118 6,-110 C12,-124 32,-118 30,-100 C36,-92 28,-78 17,-80 C10,-70 -8,-72 -10,-80 C-24,-78 -30,-88 -24,-92Z" '
            f'fill="{MANE}" stroke="{INK}" stroke-width="4.5" stroke-linejoin="round"/>'
            f'<ellipse cx="-38" cy="-66" rx="12" ry="6" fill="{WHITE}" opacity=".35" transform="rotate(-30 -38 -66)"/>'
            + "".join(f'<ellipse cx="{x}" cy="10" rx="12" ry="7" fill="{CHEEK}" opacity=".9"/>' for x in (-50, 50))
            + eyes(eye)
            + f'<ellipse cx="-15" cy="40" rx="4.5" ry="6.5" fill="{INK}"/><ellipse cx="15" cy="40" rx="4.5" ry="6.5" fill="{INK}"/>'
            + mouth(mo) + extra_front)

def body(bib=True):
    b = (stroke_path("M46,84 C74,78 86,96 80,120", MANE, 16) +
         f'<ellipse cx="0" cy="100" rx="56" ry="34" fill="{COAT}" stroke="{INK}" stroke-width="5.5"/>')
    if bib:
        b += (f'<path d="M-18,90 h36 v24 q0,6 -6,6 h-24 q-6,0 -6,-6z" fill="{WHITE}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
              f'<text x="0" y="113" text-anchor="middle" font-family="\'M PLUS Rounded 1c\', sans-serif" font-weight="800" font-size="22" fill="{RED}">1</text>')
    return b

def foal(x, y, s=0.78, rot=0, head_rot=0, eye="normal", mo="smile", ear="up",
         back=None, front=None, raise_leg=False, bib=True, over_body="", head_extra="", front_extra=""):
    back = LEGS_STAND["back"] if back is None else back
    front = LEGS_STAND["front"] if front is None else front
    raised = leg("M22,100 C46,90 70,60 76,30", (78, 24), -70) if raise_leg else ""
    return (f'<g transform="translate({x},{y}) rotate({rot}) scale({s})">'
            + back + front + body(bib) + over_body
            + f'<g transform="rotate({head_rot} 0 60)">{head(eye, mo, ear, head_extra)}</g>'
            + front_extra + raised + "</g>")

def label(text, y):
    lines = text.split("/")
    size = min(44 if len(lines) == 1 else 40, int(278 / max(len(l) for l in lines)))
    ys = [y] if len(lines) == 1 else [y - size - 2, y]
    return "".join(f'<text x="160" y="{yy}" text-anchor="middle" font-family="\'M PLUS Rounded 1c\', sans-serif" '
                   f'font-weight="800" font-size="{size}" fill="{INK}">{l}</text>' for l, yy in zip(lines, ys))

def heart(x, y, s=1, c=RED):
    return (f'<path transform="translate({x},{y}) scale({s})" d="M0,6 C-14,-4 -10,-16 0,-9 C10,-16 14,-4 0,6Z" '
            f'fill="{c}" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>')

def sparkle(x, y, s=1, c=GOLD):
    return (f'<path transform="translate({x},{y}) scale({s})" d="M0,-12 Q2,-2 12,0 Q2,2 0,12 Q-2,2 -12,0 Q-2,-2 0,-12Z" '
            f'fill="{c}" stroke="{INK}" stroke-width="2.5" stroke-linejoin="round"/>')

def motion(x, y, rot):
    return (f'<g transform="translate({x},{y}) rotate({rot})" stroke="{INK}" stroke-width="5" stroke-linecap="round">'
            f'<path d="M0,0 v-14"/><path d="M14,4 l8,-10"/><path d="M-14,4 l-8,-10"/></g>')

def puff(x, y, s=1):
    return (f'<path transform="translate({x},{y}) scale({s})" d="M-18,6 a10,10 0 0 1 4,-16 a12,12 0 0 1 20,-2 a10,10 0 0 1 12,14 z" '
            f'fill="{WHITE}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/>')

STAMPS = []
def stamp(sid, text, body_svg, text_y=292):
    STAMPS.append({"id": sid, "text": text, "body": body_svg, "text_y": text_y})

# 1 ヒヒーン！: 前脚をあげて大よろこび
rear_l = leg("M-22,100 C-46,90 -70,60 -76,30", (-78, 24), 70)
rear_r = leg("M22,100 C46,90 70,60 76,30", (78, 24), -70)
bang = "".join(f'<g transform="translate({x},{y}) rotate({r})"><path d="M-5,-26 h10 l-2,30 h-6z" fill="{RED}" stroke="{INK}" stroke-width="3.5" stroke-linejoin="round"/><circle cy="14" r="5.5" fill="{RED}" stroke="{INK}" stroke-width="3.5"/></g>' for x, y, r in ((40, 70, -18), (282, 64, 18)))
stamp("hihiin", "ヒヒーン！", bang + sparkle(70, 150, .8) + sparkle(252, 150, .7, TEAL)
      + foal(160, 140, rot=-4, eye="sparkle", mo="open", ear="perk",
             back=leg("M-40,108 L-44,136", (-44, 140)) + leg("M40,108 L44,136", (44, 140)), front="", front_extra=rear_l + rear_r))

# 2 ゴール！: ゴールテープを切る
tape = (f'<path d="M-120,98 C-80,92 -50,96 -30,100 M30,100 C50,96 80,104 120,94" fill="none" stroke="{INK}" stroke-width="14" stroke-linecap="round"/>'
        f'<path d="M-120,98 C-80,92 -50,96 -30,100 M30,100 C50,96 80,104 120,94" fill="none" stroke="{RED}" stroke-width="7" stroke-linecap="round"/>'
        f'<path d="M-30,100 C-10,108 10,108 30,100" fill="none" stroke="{INK}" stroke-width="14" stroke-linecap="round"/>'
        f'<path d="M-30,100 C-10,108 10,108 30,100" fill="none" stroke="{RED}" stroke-width="7" stroke-linecap="round"/>')
flag = (f'<g transform="translate(262,40)"><path d="M0,0 v70" stroke="{INK}" stroke-width="6" stroke-linecap="round"/>'
        f'<rect x="2" y="0" width="36" height="24" fill="{WHITE}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
        + "".join(f'<rect x="{2+i*12}" y="{j*12}" width="12" height="12" fill="{INK}"/>' for i in range(3) for j in range(2) if (i+j)%2==0) + "</g>")
confetti2 = "".join(f'<rect x="{x}" y="{y}" width="10" height="16" rx="2" fill="{c}" stroke="{INK}" stroke-width="2.5" transform="rotate({r} {x} {y})"/>'
                    for x, y, c, r in ((46, 40, GOLD, -20), (84, 16, TEAL, 20), (222, 20, RED, 30)))
stamp("goal", "ゴール！", confetti2 + flag + foal(160, 134, head_rot=-4, eye="happy", mo="open", over_body=tape))

# 3 にんじんください: うるうるおねだり
bubble = (f'<circle cx="92" cy="146" r="6" fill="{WHITE}" stroke="{INK}" stroke-width="3.5"/>'
          f'<circle cx="74" cy="122" r="9" fill="{WHITE}" stroke="{INK}" stroke-width="3.5"/>'
          f'<ellipse cx="66" cy="72" rx="50" ry="36" fill="{WHITE}" stroke="{INK}" stroke-width="4.5"/>'
          f'<g transform="translate(58,74) rotate(-30)">'
          f'<path d="M-4,-10 C18,-12 52,-6 60,0 C52,6 18,12 -4,10 C-10,6 -10,-6 -4,-10Z" transform="translate(-24,0) scale(.8)" fill="#f28a3c" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
          f'<path d="M-28,-2 C-40,-16 -44,-8 -48,-14 M-28,2 C-42,6 -44,-2 -50,2" fill="none" stroke="#4fae5a" stroke-width="5" stroke-linecap="round"/></g>')
tears = "".join(f'<path d="M{x},-2 q-5,10 0,14 q5,-4 0,-14z" fill="#9fd8f5" stroke="{INK}" stroke-width="2.5"/>' for x in (-46, 46))
stamp("ninjin", "にんじんください", bubble + foal(186, 138, head_rot=10, eye="sparkle", mo="small", ear="back", head_extra=tears))

# 4 ひとやすみ: ふせて鼻ちょうちん
tuck = "".join(f'<ellipse cx="{x}" cy="130" rx="13" ry="8" fill="{HOOF}" stroke="{INK}" stroke-width="4"/>' for x in (-30, 30))
snot = (f'<circle cx="22" cy="54" r="14" fill="#dff3ff" stroke="{INK}" stroke-width="3.5" opacity=".95"/>'
        f'<ellipse cx="18" cy="49" rx="4" ry="2.5" fill="{WHITE}"/>')
zzz = "".join(f'<text x="{x}" y="{y}" font-family="\'M PLUS Rounded 1c\', sans-serif" font-weight="800" font-size="{fs}" fill="{INK}">Z</text>' for x, y, fs in ((234, 96, 30), (260, 66, 24), (280, 42, 18)))
grass = (f'<path d="M40,232 C90,222 230,222 280,232" fill="none" stroke="{INK}" stroke-width="12" stroke-linecap="round"/>'
         f'<path d="M40,232 C90,222 230,222 280,232" fill="none" stroke="#8fcf6e" stroke-width="5" stroke-linecap="round"/>')
stamp("hitoyasumi", "ひとやすみ", grass + zzz + foal(150, 128, s=.7, head_rot=-10, eye="closed", mo="none", ear="back",
      back="", front="", over_body=tuck, head_extra=snot))

# 5 参戦します！: かけだす
dash = f'<g stroke="{INK}" stroke-width="5" stroke-linecap="round"><path d="M22,120 h40"/><path d="M12,150 h54"/><path d="M30,180 h34"/></g>'
stamp("sansen", "参戦します！", dash + puff(90, 214, 1.1) + puff(58, 196, .8)
      + foal(176, 136, rot=-10, head_rot=-6, eye="fire", mo="open", ear="back",
             back=leg("M-40,104 C-60,112 -70,118 -80,116", (-84, 116), 80) + leg("M40,104 L42,130", (42, 134)),
             front=leg("M-22,112 L-22,144", (-22, 148)) + leg("M22,108 C40,112 54,106 64,96", (68, 92), -50)))

# 6 がんばります！: はちまき
hachi = (f'<path d="M-68,-52 C-30,-66 30,-66 68,-52 L66,-38 C30,-50 -30,-50 -66,-38Z" fill="{WHITE}" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
         f'<circle cx="0" cy="-50" r="7" fill="{RED}"/>'
         f'<path d="M64,-48 C84,-58 96,-50 104,-60 M64,-44 C82,-38 94,-44 104,-34" fill="none" stroke="{INK}" stroke-width="11" stroke-linecap="round"/>'
         f'<path d="M64,-48 C84,-58 96,-50 104,-60 M64,-44 C82,-38 94,-44 104,-34" fill="none" stroke="{WHITE}" stroke-width="5" stroke-linecap="round"/>')
flame = "".join(f'<path transform="translate({x},{y}) scale({s})" d="M0,14 C-14,14 -16,0 -8,-8 C-8,0 -2,0 -2,-6 C-2,-16 6,-20 8,-26 C10,-14 16,-8 14,2 C12,10 8,14 0,14Z" fill="#f28a3c" stroke="{INK}" stroke-width="3" stroke-linejoin="round"/>' for x, y, s in ((62, 150, 1.4), (262, 140, 1.2)))
stamp("ganbarimasu", "がんばります！", flame + foal(160, 134, eye="fire", mo="open", head_extra=hachi))

# 7 おつかれさまです: にんじん
carrot = (f'<g transform="translate(34,58) rotate(-24)">'
          f'<path d="M-4,-10 C18,-12 52,-6 60,0 C52,6 18,12 -4,10 C-10,6 -10,-6 -4,-10Z" fill="#f28a3c" stroke="{INK}" stroke-width="4" stroke-linejoin="round"/>'
          f'<path d="M20,-6 l4,6 M36,-3 l3,5" stroke="{INK}" stroke-width="3" stroke-linecap="round"/>'
          f'<path d="M-4,-2 C-18,-18 -22,-10 -26,-16 M-4,2 C-20,6 -22,-2 -30,2 M-4,0 C-16,16 -24,10 -28,18" fill="none" stroke="#4fae5a" stroke-width="6" stroke-linecap="round"/></g>')
stamp("otsukare", "おつかれ/さまです", foal(160, 112, s=.68, eye="calm", mo="none", ear="back", head_extra=carrot)
      + f'<g fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round"><path d="M236,78 q14,-6 26,2"/><path d="M242,96 q14,-2 22,8"/></g>')

# 8 おめでとうございます: 優勝レイ
lei = ""
import math
for i in range(9):
    t = math.pi * (0.12 + 0.76 * i / 8)
    fx, fy = -58 * math.cos(t), 64 + 30 * math.sin(t)
    c = RED if i % 2 == 0 else GOLD
    lei += (f'<g transform="translate({fx:.1f},{fy:.1f})">' +
            "".join(f'<circle cx="{7*math.cos(a*math.pi/2.5):.1f}" cy="{7*math.sin(a*math.pi/2.5):.1f}" r="6.5" fill="{c}" stroke="{INK}" stroke-width="2.5"/>' for a in range(5))
            + f'<circle r="4" fill="{WHITE}" stroke="{INK}" stroke-width="2"/></g>')
confetti = "".join(f'<rect x="{x}" y="{y}" width="10" height="16" rx="2" fill="{c}" stroke="{INK}" stroke-width="2.5" transform="rotate({r} {x} {y})"/>'
                   for x, y, c, r in ((50, 50, RED, -20), (84, 22, TEAL, 20), (240, 28, GOLD, 30), (276, 70, RED, -15), (40, 150, GOLD, 40), (282, 150, TEAL, -30)))
stamp("omedetou", "おめでとう/ございます", confetti + foal(160, 112, s=.68, eye="happy", mo="open", bib=False, front_extra=lei))

def svg(st, uid):
    f = (f'<defs><filter id="ol{uid}" x="-5%" y="-5%" width="110%" height="110%">'
         f'<feMorphology in="SourceAlpha" operator="dilate" radius="7" result="d"/>'
         f'<feFlood flood-color="#fff"/><feComposite in2="d" operator="in" result="w"/>'
         f'<feMerge><feMergeNode in="w"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>')
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">{f}'
            f'<g filter="url(#ol{uid})">{st["body"]}{label(st["text"], st["text_y"])}</g></svg>')

if __name__ == "__main__":
    json.dump([{"id": s["id"], "text": s["text"], "svg": svg(s, f"k{i}")} for i, s in enumerate(STAMPS)],
              open("koma.json", "w"), ensure_ascii=False)
    print(len(STAMPS))
