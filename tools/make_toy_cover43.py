#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make_toy_cover43.py — B 站 Toy 封面（4:3，平台规格 1200×900）

为什么单独写一份：`make_toy_cover.py` 是给 16:9 调的绝对坐标，直接改 W/H 会把
色条压到标签上、战利品卡跑出画布。这里所有位置都按 W/H 的比例算，4:3 才不会崩。

输出：dist/borderops-cover-1200x900.png
"""
import json, math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 900
random.seed(20261109)

TIERS = ["#867b61", "#4c9d2e", "#559edf", "#bc94e9", "#ef93d6",
         "#f5a8a2", "#f2bd54", "#b6de19", "#76ebd7"]
AMBER, GOLD = (255, 180, 74), (255, 210, 63)
STEEL, GREEN, WHITE = (98, 200, 255), (143, 224, 122), (238, 244, 250)

F_CN   = "C:/Windows/Fonts/msyhbd.ttc"
F_LAT  = "C:/Windows/Fonts/arialbd.ttf"
F_MONO = "C:/Windows/Fonts/consola.ttf"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
VER = json.load(open(os.path.join(ROOT, "package.json"), encoding="utf-8"))["version"]

def font(p, s): return ImageFont.truetype(p, s)
def hx(c):
    c = c.lstrip("#"); return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def vgrad(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h)); d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / max(1, h - 1)
        d.point((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return img.resize(size, Image.BILINEAR)

def radial(size, color, alpha=255, power=2.4):
    w, h = size
    layer = Image.new("L", (w, h), 0); d = ImageDraw.Draw(layer)
    for i in range(64, 0, -1):
        k = i / 64; a = int(alpha * (1 - k) ** power); r = k * min(w, h) / 2
        d.ellipse([w/2-r, h/2-r, w/2+r, h/2+r], fill=a)
    layer = layer.filter(ImageFilter.GaussianBlur(min(w, h) / 40))
    out = Image.new("RGBA", size, color + (0,)); out.putalpha(layer); return out

# 岩石轮廓与游戏内一致
ROCK = [(0.06, 0.55), (0.24, 0.10), (0.62, 0.04), (0.94, 0.42), (0.84, 0.90), (0.36, 0.96)]

base = vgrad((W, H), (6, 10, 14), (18, 26, 34)).convert("RGBA")
base.alpha_composite(radial((W, H), (28, 58, 86), 150))
base.alpha_composite(radial((int(W*0.7), int(W*0.7)), (90, 150, 200), 85), (int(W*0.55), int(-H*0.25)))

# ---------------- 俯视图元素（全部按比例） ----------------
map_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(map_layer)
GRID = int(W / 20)
for x in range(0, W, GRID): d.line([(x, 0), (x, H)], fill=(90, 130, 160, 12))
for y in range(0, H, GRID): d.line([(0, y), (W, y)], fill=(90, 130, 160, 12))
d.polygon([(-60, H*0.80), (W*0.45, H*0.66), (W*1.05, H*0.74), (W*1.1, H*0.90),
           (W*0.42, H*0.84), (-60, H*0.95)], fill=(30, 66, 82, 38))
d.line([(-60, H*0.80), (W*0.45, H*0.66), (W*1.05, H*0.74)], fill=(90, 170, 200, 52), width=2)
d.line([(0, H*0.28), (W, H*0.20)], fill=(120, 120, 110, 24), width=int(H*0.012))
d.line([(W*0.28, 0), (W*0.34, H)], fill=(120, 120, 110, 20), width=int(H*0.010))

rooms = [(0.62, 0.10, 0.16, 0.15), (0.79, 0.10, 0.13, 0.15), (0.62, 0.27, 0.13, 0.13),
         (0.76, 0.27, 0.16, 0.13), (0.62, 0.42, 0.30, 0.14)]
for (rx, ry, rw, rh) in rooms:
    d.rectangle([W*rx, H*ry, W*(rx+rw), H*(ry+rh)], fill=(52, 74, 92, 24),
                outline=(120, 165, 195, 55), width=2)

for (cx, cy, s) in [(0.72, 0.50, 0.10), (0.90, 0.62, 0.075), (0.50, 0.86, 0.075), (0.95, 0.22, 0.06)]:
    pts = [(W*cx + (u-0.5)*W*s, H*cy + (v-0.5)*W*s*0.92) for u, v in ROCK]
    d.polygon(pts, fill=(58, 62, 58, 110), outline=(150, 160, 140, 85))
base.alpha_composite(map_layer)

# ---------------- 光锥 + 玩家 ----------------
beam = Image.new("RGBA", (W, H), (0, 0, 0, 0)); bd = ImageDraw.Draw(beam)
PX, PY = W*0.63, H*0.46
for (bx, by, ang, ln, half, col, a, core) in [
    (PX, PY, -0.55, W*0.52, 0.19, AMBER, 38, 74),
    (W*0.80, H*0.28, 0.30, W*0.34, 0.15, STEEL, 28, 54),
]:
    for hh, aa in ((half, a), (half*0.45, core)):
        bd.polygon([(bx, by),
                    (bx + math.cos(ang-hh)*ln, by + math.sin(ang-hh)*ln),
                    (bx + math.cos(ang+hh)*ln, by + math.sin(ang+hh)*ln)], fill=col + (aa,))
base.alpha_composite(beam.filter(ImageFilter.GaussianBlur(18)))

pl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); pd = ImageDraw.Draw(pl)
r0 = W*0.030
pd.ellipse([PX-r0*1.7, PY-r0*1.7, PX+r0*1.7, PY+r0*1.7], fill=AMBER + (44,))
pd.ellipse([PX-r0, PY-r0, PX+r0, PY+r0], outline=AMBER + (200,), width=3)
pd.ellipse([PX-r0*0.5, PY-r0*0.5, PX+r0*0.5, PY+r0*0.5], fill=(255, 226, 168, 235))
base.alpha_composite(pl)

# ---------------- 撤离点 ----------------
ex, ey = W*0.90, H*0.30
exl = Image.new("RGBA", (W, H), (0, 0, 0, 0)); ed = ImageDraw.Draw(exl)
for i in range(3):
    r = W*0.020 + i*W*0.009
    ed.ellipse([ex-r, ey-r, ex+r, ey+r], outline=GREEN + (150-i*40,), width=2)
ed.polygon([(ex, ey-W*0.011), (ex+W*0.009, ey+W*0.008), (ex, ey+W*0.003), (ex-W*0.009, ey+W*0.008)],
           fill=GREEN + (235,))
ed.text((ex-W*0.017, ey+W*0.030), "EXFIL", font=font(F_MONO, int(H*0.020)), fill=GREEN + (215,))
base.alpha_composite(exl)

# ---------------- 暗角 / 压暗 / 颗粒 ----------------
vig = Image.new("L", (W, H), 0); vd = ImageDraw.Draw(vig)
for i in range(40):
    k = i/40; a = int(230*(k**2.2)); inflate = int(-W*0.14*(1-k))
    vd.rectangle([inflate, inflate, W-inflate, H-inflate], outline=255-a, width=int(W*0.14*(1-k))+2)
dark = Image.new("RGBA", (W, H), (2, 4, 6, 255))
dark.putalpha(vig.filter(ImageFilter.GaussianBlur(70)).point(lambda v: int(v*0.95)))
base.alpha_composite(dark)

scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0)); sd = ImageDraw.Draw(scrim)
for i in range(80):
    x = int(W*0.60 - i*(W*0.010))
    if x < -30: break
    sd.rectangle([x, 0, x+int(W*0.012), H], fill=(3, 6, 9, 12))
base.alpha_composite(scrim.filter(ImageFilter.GaussianBlur(50)))

grain = Image.new("RGBA", (W, H), (0, 0, 0, 0)); gd = ImageDraw.Draw(grain)
for _ in range(24000):
    gx, gy = random.randrange(W), random.randrange(H); v = random.randint(120, 255)
    gd.point((gx, gy), fill=(v, v, v, random.randint(4, 16)))
base.alpha_composite(grain)

scan = Image.new("RGBA", (W, 4), (0, 0, 0, 0))
ImageDraw.Draw(scan).line([(0, 0), (W, 0)], fill=(0, 0, 0, 24), width=1)
for y in range(0, H, 4): base.alpha_composite(scan, (0, y))

# ---------------- 文本（4:3 版面） ----------------
draw = ImageDraw.Draw(base)
TX, TY = W*0.050, H*0.185
TITLE_SIZE = int(H*0.185)

# 顶部标识
draw.rectangle([TX, H*0.055, TX+W*0.0045, H*0.105], fill=AMBER + (255,))
draw.text((TX+W*0.018, H*0.052), "BILIBILI TOY", font=font(F_LAT, int(H*0.030)), fill=(230, 238, 246))
draw.text((TX+W*0.018, H*0.088), "可玩互动内容 · 无需下载", font=font(F_CN, int(H*0.022)), fill=(150, 168, 184))
vtxt = "v" + VER
vw = draw.textbbox((0, 0), vtxt, font=font(F_MONO, int(H*0.024)))[2]
draw.text((W-TX-vw, H*0.055), vtxt, font=font(F_MONO, int(H*0.024)), fill=(120, 140, 158))

# 主标题（阴影单层 + 模糊）
title = "边境行动"; f_title = font(F_CN, TITLE_SIZE)
tw = draw.textbbox((0, 0), title, font=f_title)[2]
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).text((TX+2, TY+H*0.012), title, font=f_title, fill=(0, 0, 0, 165))
base.alpha_composite(sh.filter(ImageFilter.GaussianBlur(11)))
draw = ImageDraw.Draw(base)
draw.text((TX, TY), title, font=f_title, fill=WHITE)

# 英文 + 分隔线 + 副标题
draw.text((TX+4, TY+TITLE_SIZE*1.18), "B O R D E R   O P S", font=font(F_LAT, int(H*0.046)), fill=AMBER)
draw.line([(TX+6, TY+TITLE_SIZE*1.62), (TX+6+tw*0.92, TY+TITLE_SIZE*1.62)], fill=AMBER + (110,), width=3)
draw.text((TX+4, TY+TITLE_SIZE*1.70), "双视角撤离射击 · 搜刮 / 交战 / 活着带出去",
          font=font(F_CN, int(H*0.036)), fill=(206, 218, 230))

# 卖点：两行两列（4:3 宽度不够横排四个）
feats = ["第一人称 · 俯视 双视角", "12 家兵工厂", "9 阶军规品质", "配件与改装模块"]
fy = TY + TITLE_SIZE*2.16
for i, t in enumerate(feats):
    f = font(F_CN, int(H*0.024))
    bw = draw.textbbox((0, 0), t, font=f)[2]
    fx = TX + (i % 2) * (W*0.245)
    fyy = fy + (i // 2) * (H*0.055)
    draw.rounded_rectangle([fx, fyy, fx+bw+W*0.026, fyy+H*0.040], radius=5,
                           outline=(120, 145, 165, 125), width=2)
    draw.text((fx+W*0.013, fyy+H*0.008), t, font=f, fill=(190, 206, 220))

# ---------------- 战利品卡（右下，纵向堆叠） ----------------
def card(im, x, y, w, h, rarity, title_t, lines):
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0)); cd = ImageDraw.Draw(lay)
    cd.rounded_rectangle([x, y, x+w, y+h], radius=8, fill=(8, 12, 16, 232),
                         outline=(90, 110, 128, 150), width=2)
    cd.rounded_rectangle([x, y, x+5, y+h], radius=2, fill=hx(rarity) + (255,))
    cd.text((x+w*0.045, y+h*0.10), title_t, font=font(F_CN, int(H*0.024)), fill=hx(rarity))
    yy = y + h*0.44
    for ln in lines:
        cd.text((x+w*0.045, yy), ln, font=font(F_CN, int(H*0.019)), fill=(176, 192, 206))
        yy += h*0.28
    return Image.alpha_composite(im, lay)

base = card(base, W*0.545, H*0.615, W*0.405, H*0.115, TIERS[7],
            "定制 · 精修突击步枪", ["伤害 78.4   弹匣 30   精度 92%"])
base = card(base, W*0.545, H*0.745, W*0.405, H*0.105, TIERS[8],
            "孤品 · 估值 120 万", ["配件 6 / 6  ·  改装 3 级"])

# ---------------- 底部：品质条 + 说明 ----------------
draw = ImageDraw.Draw(base)
sw = W*0.031; gap = W*0.006
sx, sy = TX, H*0.905
draw.text((sx, sy-H*0.042), "9 阶军规品质", font=font(F_CN, int(H*0.020)), fill=(140, 158, 174))
for i, c in enumerate(TIERS):
    x0 = sx + i*(sw+gap)
    draw.rounded_rectangle([x0, sy, x0+sw, sy+sw], radius=4, fill=hx(c)+(215,), outline=(0,0,0,120), width=1)
    draw.text((x0+sw*0.22, sy+sw+H*0.008), "T%d" % (i+1), font=font(F_MONO, int(H*0.015)), fill=(118, 134, 150))

foot = "borderops · webaudio · zero build"
fw = draw.textbbox((0, 0), foot, font=font(F_MONO, int(H*0.019)))[2]
draw.text((W-TX-fw, H*0.955), foot, font=font(F_MONO, int(H*0.019)), fill=(96, 114, 130))

out = os.path.join(ROOT, "dist", "borderops-cover-%dx%d.png" % (W, H))
base.convert("RGB").save(out, quality=95)
print(out, "ok", round(len(open(out, "rb").read())/1024, 1), "KB")
