#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
make_toy_cover.py — 生成 B 站 Toy 的封面（16:9）与作品图标（1:1）

全部用代码绘制，不依赖外部素材：
  · 配色直接取自游戏本体（RAID_TIERS / RARITIES 的 12 阶品质色、商店琥珀色）；
  · 岩石用的是游戏里 rock 的同一个六边形轮廓（RAID_ROCK_HEX 的 6 个顶点）；
  · 光锥/网格/房间线框还原「海关流域」俯视图的观感。

输出：
  dist/borderops-cover-1920x1080.png   （封面，16:9）
  dist/borderops-icon-512.png          （作品图标，1:1）
"""
import math, random, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W = int(__import__('os').environ.get('COVER_W', 1920))
H = int(__import__('os').environ.get('COVER_H', 1080))
RATIO43 = abs(W/H - 4/3) < 0.02
random.seed(20261109)

TIERS = ["#867b61", "#4c9d2e", "#559edf", "#bc94e9", "#ef93d6",
         "#f5a8a2", "#f2bd54", "#b6de19", "#76ebd7"]
AMBER = (255, 180, 74)
GOLD  = (255, 210, 63)
STEEL = (98, 200, 255)
GREEN = (143, 224, 122)
WHITE = (238, 244, 250)

F_CN   = "C:/Windows/Fonts/msyhbd.ttc"
F_LAT  = "C:/Windows/Fonts/arialbd.ttf"
F_MONO = "C:/Windows/Fonts/consola.ttf"

def font(path, size):
    return ImageFont.truetype(path, size)

def hx(c):
    c = c.lstrip("#")
    return tuple(int(c[i:i+2], 16) for i in (0, 2, 4))

def vgrad(size, top, bottom):
    w, h = size
    img = Image.new("RGB", (1, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        k = y / max(1, h - 1)
        d.point((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * k) for i in range(3)))
    return img.resize(size, Image.BILINEAR)

def radial(size, color, alpha=255, power=2.4):
    """椭圆径向渐变（用同心圆近似，再模糊）"""
    w, h = size
    layer = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(layer)
    steps = 64
    for i in range(steps, 0, -1):
        k = i / steps
        a = int(alpha * (1 - k) ** power)
        r = k * min(w, h) / 2
        d.ellipse([w/2 - r, h/2 - r, w/2 + r, h/2 + r], fill=a)
    layer = layer.filter(ImageFilter.GaussianBlur(min(w, h) / 40))
    out = Image.new("RGBA", size, color + (0,))
    out.putalpha(layer)
    return out

# ---------------------------------------------------------------- 背景
base = vgrad((W, H), (6, 10, 14), (18, 26, 34)).convert("RGBA")

# 远处城市/厂区的冷光
base.alpha_composite(radial((W, H), (28, 58, 86), 150).resize((W, H)))
glow = radial((1100, 1100), (90, 150, 200), 90)
base.alpha_composite(glow, (1180, -220))

map_layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
d = ImageDraw.Draw(map_layer)

# ---------------------------------------------------------------- 俯视图：网格 + 公路
GRID = 60
for x in range(0, W, GRID):
    d.line([(x, 0), (x, H)], fill=(90, 130, 160, 12), width=1)
for y in range(0, H, GRID):
    d.line([(0, y), (W, y)], fill=(90, 130, 160, 12), width=1)

# 河流（斜切的一条带）
d.polygon([(-100, 860), (760, 700), (1880, 780), (1980, 960), (700, 900), (-100, 1010)],
          fill=(30, 66, 82, 40))
d.line([(-100, 860), (760, 700), (1880, 780)], fill=(90, 170, 200, 55), width=3)

# 公路
d.line([(0, 300), (1920, 220)], fill=(120, 120, 110, 26), width=16)
d.line([(500, 0), (620, 1080)], fill=(120, 120, 110, 22), width=12)

# ---------------------------------------------------------------- 房间线框（右上角「厂区」）
rooms = [
    (1210, 120, 250, 170), (1478, 120, 190, 170), (1210, 306, 190, 150),
    (1418, 306, 250, 150), (1690, 120, 200, 336), (1210, 476, 300, 190),
    (1530, 476, 360, 190),
]
for (x, y, w, h) in rooms:
    d.rectangle([x, y, x + w, y + h], fill=(52, 74, 92, 26), outline=(120, 165, 195, 60), width=2)

# ---------------------------------------------------------------- 六边形岩石（与游戏同一轮廓）
ROCK = [(0.06, 0.55), (0.24, 0.10), (0.62, 0.04), (0.94, 0.42), (0.84, 0.90), (0.36, 0.96)]
for (cx, cy, s) in [(1330, 560, 150), (1600, 700, 110), (1120, 880, 130), (1800, 330, 90), (980, 200, 80)]:
    pts = [(cx + (u - 0.5) * s, cy + (v - 0.5) * s * 0.92) for u, v in ROCK]
    d.polygon(pts, fill=(58, 62, 58, 120), outline=(150, 160, 140, 90))
    hl = [(cx + (u - 0.5) * s * 0.55 - s * 0.10, cy + (v - 0.5) * s * 0.50 - s * 0.06) for u, v in ROCK[:5]]
    d.polygon(hl, fill=(190, 200, 175, 26))

base.alpha_composite(map_layer)

# ---------------------------------------------------------------- 光锥（手电）
beam = Image.new("RGBA", (W, H), (0, 0, 0, 0))
bd = ImageDraw.Draw(beam)
for (bx, by, ang, ln, half, col, a, core) in [
    (1150, 632, -0.55, 980, 0.19, AMBER, 40, 78),
    (1420, 380, 0.35, 760, 0.15, STEEL, 30, 58),
    (1180, 900, -0.15, 860, 0.17, GREEN, 22, 44),
]:
    p1 = (bx, by)
    for hh, aa in ((half, a), (half * 0.45, core)):
        q2 = (bx + math.cos(ang - hh) * ln, by + math.sin(ang - hh) * ln)
        q3 = (bx + math.cos(ang + hh) * ln, by + math.sin(ang + hh) * ln)
        bd.polygon([p1, q2, q3], fill=col + (aa,))
beam = beam.filter(ImageFilter.GaussianBlur(22))
base.alpha_composite(beam)

# 玩家位置：光点 + 朝向
pl = Image.new("RGBA", (W, H), (0, 0, 0, 0))
pd = ImageDraw.Draw(pl)
pd.ellipse([1150 - 46, 632 - 46, 1150 + 46, 632 + 46], fill=AMBER + (46,))
pd.ellipse([1150 - 15, 632 - 15, 1150 + 15, 632 + 15], fill=(255, 226, 168, 235))
pd.ellipse([1150 - 26, 632 - 26, 1150 + 26, 632 + 26], outline=AMBER + (210,), width=3)
pl = pl.filter(ImageFilter.GaussianBlur(2))
base.alpha_composite(pl)

# ---------------------------------------------------------------- 撤离点标记（右上）
ex_x, ex_y = 1700, 470
ex = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ed = ImageDraw.Draw(ex)
for i in range(3):
    r = 34 + i * 16
    ed.ellipse([ex_x - r, ex_y - r, ex_x + r, ex_y + r], outline=GREEN + (150 - i * 40,), width=3)
ed.polygon([(ex_x, ex_y - 16), (ex_x + 13, ex_y + 12), (ex_x, ex_y + 5), (ex_x - 13, ex_y + 12)],
           fill=GREEN + (240,))
ed.text((ex_x - 26, ex_y + 58), "EXFIL", font=font(F_MONO, 22), fill=GREEN + (220,))
base.alpha_composite(ex)

# ---------------------------------------------------------------- 战利品卡（游戏内卡片样式）
def card(im, x, y, w, h, rarity, title, lines, big=False):
    lay = Image.new("RGBA", im.size, (0, 0, 0, 0))
    cd = ImageDraw.Draw(lay)
    cd.rounded_rectangle([x, y, x + w, y + h], radius=10, fill=(8, 12, 16, 232),
                         outline=(90, 110, 128, 150), width=2)
    cd.rounded_rectangle([x, y, x + 6, y + h], radius=3, fill=hx(rarity) + (255,))
    cd.text((x + 22, y + 14), title, font=font(F_CN, 28 if big else 22), fill=hx(rarity))
    yy = y + (56 if big else 46)
    for ln in lines:
        cd.text((x + 22, yy), ln, font=font(F_CN, 20 if big else 17), fill=(176, 192, 206))
        yy += 28 if big else 23
    return Image.alpha_composite(im, lay)

# 卡片在暗角与颗粒之后绘制（它是 UI，必须比环境更亮更干净）



# ---------------------------------------------------------------- 暗角
vig = Image.new("L", (W, H), 0)
vd = ImageDraw.Draw(vig)
steps = 40
for i in range(steps):
    k = i / steps
    a = int(230 * (k ** 2.2))
    inflate = int(-260 * (1 - k))
    vd.rectangle([inflate, inflate, W - inflate, H - inflate], outline=255 - a, width=int(260 * (1 - k)) + 2)
vig = vig.filter(ImageFilter.GaussianBlur(120))
dark = Image.new("RGBA", (W, H), (2, 4, 6, 255))
dark.putalpha(vig.point(lambda v: int(v * 0.95)))
base.alpha_composite(dark)

# 左侧压暗，给标题留出对比
scrim = Image.new("RGBA", (W, H), (0, 0, 0, 0))
sd = ImageDraw.Draw(scrim)
for i in range(90):
    x = int(W * 0.62 - i * 13)
    if x < -40:
        break
    sd.rectangle([x, 0, x + 14, H], fill=(3, 6, 9, 12))
scrim = scrim.filter(ImageFilter.GaussianBlur(60))
base.alpha_composite(scrim)

# ---------------------------------------------------------------- 纹理：颗粒 + 扫描线
grain = Image.new("RGBA", (W, H), (0, 0, 0, 0))
gd = ImageDraw.Draw(grain)
for _ in range(52000):
    x, y = random.randrange(W), random.randrange(H)
    v = random.randint(120, 255)
    gd.point((x, y), fill=(v, v, v, random.randint(4, 16)))
base.alpha_composite(grain)

scan = Image.new("RGBA", (W, 4), (0, 0, 0, 0))
ImageDraw.Draw(scan).line([(0, 0), (W, 0)], fill=(0, 0, 0, 26), width=1)
for y in range(0, H, 4):
    base.alpha_composite(scan, (0, y))

# UI 层：战利品卡（放在暗角/颗粒之后，保证对比与清晰度）
base = card(base, 1210, 726, 372, 132, TIERS[7], "定制 · 精修突击步枪",
            ["伤害 78.4   弹匣 30   精度 92%", "配件 6 / 6  ·  改装 3 级"])
base = card(base, 1606, 726, 158, 132, TIERS[8], "孤品", ["伤害 121", "估值 ₽1.2M"])

# ---------------------------------------------------------------- 文本
draw = ImageDraw.Draw(base)

# 顶部标识
draw.rectangle([80, 74, 84, 118], fill=AMBER + (255,))
draw.text((104, 72), "BILIBILI TOY", font=font(F_LAT, 30), fill=(230, 238, 246))
draw.text((104, 110), "可玩互动内容 · 无需下载", font=font(F_CN, 22), fill=(150, 168, 184))
draw.text((W - 80 - 150, 80), "v0.36.2", font=font(F_MONO, 26), fill=(120, 140, 158))

# 主标题（阴影单独一层 + 模糊，避免双描边发脏）
title = "边境行动"
f_title = font(F_CN, 196)
tw = draw.textbbox((0, 0), title, font=f_title)[2]
tx, ty = 78, 300
sh = Image.new("RGBA", (W, H), (0, 0, 0, 0))
ImageDraw.Draw(sh).text((tx + 2, ty + 14), title, font=f_title, fill=(0, 0, 0, 165))
sh = sh.filter(ImageFilter.GaussianBlur(14))
base.alpha_composite(sh)
draw = ImageDraw.Draw(base)
draw.text((tx, ty), title, font=f_title, fill=WHITE)

# 英文 + 字距
lat = "B O R D E R   O P S"
draw.text((tx + 6, ty + 236), lat, font=font(F_LAT, 54), fill=AMBER)

# 分隔线
draw.line([(tx + 8, ty + 320), (tx + 8 + tw, ty + 320)], fill=AMBER + (120,), width=3)

# 副标题
draw.text((tx + 6, ty + 344), "双视角撤离射击 · 搜刮 / 交战 / 活着带出去",
          font=font(F_CN, 40), fill=(206, 218, 230))

# 卖点
feats = ["第一人称 · 俯视 双视角", "12 家兵工厂", "9 阶军规品质", "公测可玩"]
x = tx + 6
for i, t in enumerate(feats):
    f = font(F_CN, 26)
    bw = draw.textbbox((0, 0), t, font=f)[2]
    draw.rounded_rectangle([x, ty + 420, x + bw + 34, ty + 470], radius=6,
                           fill=(255, 255, 255, 0), outline=(120, 145, 165, 130), width=2)
    draw.text((x + 17, ty + 430), t, font=f, fill=(190, 206, 220))
    x += bw + 34 + 18

# ---------------------------------------------------------------- 右下：9 阶品质条 + 数据
strip_x, strip_y = W - 80 - (len(TIERS) * 46), H - 128
draw.text((strip_x, strip_y - 34), "9 阶军规品质", font=font(F_CN, 22), fill=(140, 158, 174))
for i, c in enumerate(TIERS):
    col = hx(c)
    draw.rounded_rectangle([strip_x + i * 46, strip_y, strip_x + i * 46 + 34, strip_y + 34],
                           radius=5, fill=col + (215,), outline=(0, 0, 0, 120), width=1)
    draw.text((strip_x + i * 46 + 8, strip_y + 38), "T%d" % (i + 1),
              font=font(F_MONO, 15), fill=(118, 134, 150))

draw.text((W - 80 - 470, H - 62), "单机可玩 · 存档在本地",
          font=font(F_CN, 24), fill=(150, 168, 184))

# 左下角细标
draw.text((80, H - 66), "borderops  ·  webaudio  ·  zero build",
          font=font(F_MONO, 22), fill=(96, 114, 130))

cover = base.convert("RGB")
COVER_OUT = "dist/borderops-cover-%dx%d.png" % (W, H)
cover.save(COVER_OUT, quality=95)
print(COVER_OUT, "ok", round(len(open(COVER_OUT, "rb").read()) / 1024, 1), "KB")

# ---------------------------------------------------------------- 图标 1:1
# 图标在列表里只有 64~96px，文字必然糊 —— 只留图形：六边形掩体 + 准星。
S = 512
icon = vgrad((S, S), (12, 18, 24), (26, 36, 46)).convert("RGBA")
icon.alpha_composite(radial((S, S), (255, 180, 74), 110), (0, 0))
di = ImageDraw.Draw(icon)

cx, cy, s = S // 2, S // 2, 268
# 外六边形（暗底 + 琥珀描边）
pts = [(cx + (u - 0.5) * s, cy + (v - 0.5) * s * 0.92) for u, v in ROCK]
di.polygon(pts, fill=(16, 22, 28, 255), outline=AMBER + (255,), width=9)
# 内六边形（深琥珀填充 + 亮描边）
pts2 = [(cx + (u - 0.5) * s * 0.58, cy + (v - 0.5) * s * 0.54) for u, v in ROCK]
di.polygon(pts2, fill=(112, 76, 28, 255), outline=GOLD + (240,), width=7)
# 准星
for dx, dy in [(1, 0), (-1, 0), (0, 1), (0, -1)]:
    di.line([(cx + dx * 30, cy + dy * 30), (cx + dx * 88, cy + dy * 88)],
            fill=(242, 248, 254, 245), width=7)
di.ellipse([cx - 12, cy - 12, cx + 12, cy + 12], fill=GOLD + (255,))

icon.convert("RGB").save("dist/borderops-icon-512.png", quality=95)
print("icon 512 ok", round(len(open("dist/borderops-icon-512.png", "rb").read()) / 1024, 1), "KB")
