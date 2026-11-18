#!/usr/bin/env python3
"""Иконки ODIS без внешних библиотек: градиент, кольцо прогресса и галочка (сглаживание по расстоянию).
Запуск: python3 tools/make-icons.py  → icons/icon-180.png, icon-192.png, icon-512.png, icon-maskable-512.png"""
import math, os, struct, zlib

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
C1 = (0x4F, 0x6B, 0xFF)  # синий
C2 = (0x8B, 0x5C, 0xF6)  # фиолетовый
WHITE = (255, 255, 255)
OK = (0x7C, 0xF2, 0xB0)   # мягкий зелёный для галочки


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))


def render(size, scale):
    """scale — доля размера под рисунок (для maskable меньше, чтобы попасть в безопасную зону)."""
    cx = cy = size / 2
    R = size * 0.30 * scale / 0.8
    w = size * 0.075 * scale / 0.8
    a0, a1 = -math.pi / 2, -math.pi / 2 + 2 * math.pi * 0.78   # дуга 78%, начало сверху
    caps = [(cx + R * math.cos(a), cy + R * math.sin(a)) for a in (a0, a1)]
    k = size * scale / 0.8
    p1 = (cx - 0.12 * k, cy + 0.005 * k)
    p2 = (cx - 0.035 * k, cy + 0.09 * k)
    p3 = (cx + 0.14 * k, cy - 0.095 * k)
    cw = size * 0.07 * scale / 0.8
    rows = []
    for y in range(size):
        row = bytearray([0])
        for x in range(size):
            px, py = x + 0.5, y + 0.5
            t = (px + py) / (2 * size)
            col = [C1[i] + (C2[i] - C1[i]) * t for i in range(3)]
            # кольцо
            ang = math.atan2(py - cy, px - cx)
            rel = (ang - a0) % (2 * math.pi)
            if rel <= (a1 - a0):
                d = abs(math.hypot(px - cx, py - cy) - R) - w / 2
            else:
                d = min(math.hypot(px - qx, py - qy) for qx, qy in caps) - w / 2
            cov = max(0.0, min(1.0, 0.5 - d))
            # бледная дорожка кольца
            dt = abs(math.hypot(px - cx, py - cy) - R) - w / 2
            tcov = max(0.0, min(1.0, 0.5 - dt)) * 0.22
            col = [c + (255 - c) * tcov for c in col]
            col = [c + (WHITE[i] - c) * cov for i, c in enumerate(col)]
            # галочка
            dc = min(seg_dist(px, py, *p1, *p2), seg_dist(px, py, *p2, *p3)) - cw / 2
            ccov = max(0.0, min(1.0, 0.5 - dc))
            col = [c + (WHITE[i] - c) * ccov for i, c in enumerate(col)]
            row += bytes(int(round(c)) for c in col)
        rows.append(bytes(row))
    raw = b''.join(rows)

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))


if __name__ == '__main__':
    out = os.path.join(ROOT, 'icons')
    os.makedirs(out, exist_ok=True)
    for name, size, scale in [('icon-180.png', 180, 0.8), ('icon-192.png', 192, 0.8), ('icon-512.png', 512, 0.8), ('icon-maskable-512.png', 512, 0.62)]:
        with open(os.path.join(out, name), 'wb') as f:
            f.write(render(size, scale))
        print('ok', name)
