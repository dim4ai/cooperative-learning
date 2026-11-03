#!/usr/bin/env python3
"""Test lessons for the editor/teacher/student: python3 testdata/make_lessons.py [out_dir]
Default out_dir: public/testdata (gitignored; dev vite serves it at /testdata/...).
  drobi       — realistic small lesson, all 4 block types, all object kinds, hidden/✋, PDF+PNG attachments
  heavy       — stress: 40 slides, Full HD noise PNGs (~6 MB each), a 4K PNG (~25 MB), 1080p mp4+webm
  edge        — edge cases: old `scene` field, missing media, unknown fields, weird names, svg/gif/webp, empty blocks
  broken-*    — files the editor must reject with a clear message
"""
import io, json, math, os, random, subprocess, sys, tempfile, zipfile
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', 'public', 'testdata')
os.makedirs(OUT, exist_ok=True)
random.seed(42)
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
font = lambda s: ImageFont.truetype(FONT, s)
W, H = 1600, 900
_n = 0
def uid():
    global _n; _n += 1; return f'u{_n:04d}'

# ---------- media ----------
def png(im): b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()
def jpg(im, q=92): b = io.BytesIO(); im.save(b, 'JPEG', quality=q); return b.getvalue()

def pie(parts, filled, size=500, color=(59, 130, 246)):
    im = Image.new('RGBA', (size, size), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for i in range(parts):
        a0, a1 = -90 + 360 * i / parts, -90 + 360 * (i + 1) / parts
        d.pieslice([10, 10, size - 10, size - 10], a0, a1, fill=color if i < filled else (241, 245, 249), outline=(30, 41, 59), width=4)
    return png(im)

def photo(w, h, seed):
    """Smooth 'landscape' + grain: compresses like a real photo"""
    r = random.Random(seed)
    sky, ground = (r.randint(80, 160), r.randint(140, 200), 255), (r.randint(40, 120), r.randint(120, 180), r.randint(40, 90))
    im = Image.new('RGB', (w, h)); d = ImageDraw.Draw(im)
    hz = int(h * r.uniform(0.45, 0.65))
    for y in range(h):
        c0, c1, t = (sky, (255, 255, 255), y / hz) if y < hz else (ground, (20, 40, 20), (y - hz) / (h - hz))
        d.line([(0, y), (w, y)], fill=tuple(int(a + (b - a) * t * 0.6) for a, b in zip(c0, c1)))
    for _ in range(12):
        x, s = r.randint(0, w), r.randint(h // 10, h // 3)
        d.ellipse([x - s, hz - s // 2, x + s, hz + s // 2], fill=(r.randint(20, 70), r.randint(70, 120), r.randint(20, 60)))
    grain = Image.effect_noise((w, h), 30).convert('RGB')
    return Image.blend(im, grain, 0.12)

def noise_png(w, h, tint):
    im = Image.frombytes('RGB', (w, h), os.urandom(w * h * 3))
    return png(Image.blend(im, Image.new('RGB', (w, h), tint), 0.5))

def card_png(text, w=1200, h=800, bg=(255, 251, 235)):
    im = Image.new('RGB', (w, h), bg); d = ImageDraw.Draw(im)
    d.rectangle([20, 20, w - 20, h - 20], outline=(180, 83, 9), width=8)
    y = 80
    for line in text.split('\n'):
        d.text((80, y), line, font=font(56), fill=(30, 30, 30)); y += 90
    return png(im)

def pdf(pages):
    ims = []
    for i, t in enumerate(pages):
        im = Image.new('RGB', (1240, 1754), 'white'); d = ImageDraw.Draw(im)
        d.text((100, 100), f'Стр. {i + 1}', font=font(40), fill='gray')
        y = 220
        for line in t.split('\n'):
            d.text((100, y), line, font=font(48), fill='black'); y += 80
        ims.append(im)
    b = io.BytesIO(); ims[0].save(b, 'PDF', save_all=True, append_images=ims[1:], resolution=150); return b.getvalue()

def video(ext, seconds, size='1920x1080'):
    with tempfile.TemporaryDirectory() as t:
        p = os.path.join(t, 'v.' + ext)
        codec = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p'] if ext == 'mp4' else ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime']
        subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc2=size={size}:rate=30:duration={seconds}',
                        '-f', 'lavfi', '-i', f'sine=frequency=440:duration={seconds}', *codec, '-shortest', p], check=True)
        return open(p, 'rb').read()

def svg():
    return ('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400">'
            '<circle cx="200" cy="200" r="180" fill="#fde68a" stroke="#92400e" stroke-width="8"/>'
            '<path d="M200 20 A180 180 0 0 1 380 200 L200 200 Z" fill="#f59e0b"/>'
            '<text x="200" y="215" font-size="48" text-anchor="middle" font-family="sans-serif">1/4</text></svg>').encode()

def gif():
    frames = []
    for i in range(8):
        im = Image.new('RGB', (300, 300), 'white'); ImageDraw.Draw(im).pieslice([20, 20, 280, 280], -90, -90 + 45 * (i + 1), fill=(220, 38, 38))
        frames.append(im)
    b = io.BytesIO(); frames[0].save(b, 'GIF', save_all=True, append_images=frames[1:], duration=200, loop=0); return b.getvalue()

def webp(): b = io.BytesIO(); photo(1024, 768, 7).save(b, 'WEBP', quality=85); return b.getvalue()

def size_of(data):
    try: return Image.open(io.BytesIO(data)).size
    except Exception: return (400, 400)

# ---------- scene objects (Fabric 7 JSON, center origin like the editor) ----------
C = {'originX': 'center', 'originY': 'center'}
def image(name, media, left, top, width=None, **kw):
    w, h = size_of(media[name]); s = (width or w) / w
    return {'type': 'Image', 'uid': uid(), 'mediaName': name, **C, 'left': left, 'top': top, 'width': w, 'height': h, 'scaleX': s, 'scaleY': s, **kw}
def text(t, left, top, size=48, width=600, **kw):
    return {'type': 'Textbox', 'uid': uid(), 'text': t, **C, 'left': left, 'top': top, 'width': width, 'fontSize': size,
            'fontFamily': 'sans-serif', 'fill': '#0f172a', 'textAlign': 'center', **kw}
def rect(left, top, w, h, fill='#bfdbfe', **kw):
    return {'type': 'Rect', 'uid': uid(), **C, 'left': left, 'top': top, 'width': w, 'height': h, 'rx': 12, 'ry': 12,
            'fill': fill, 'stroke': '#1e3a8a', 'strokeWidth': 3, **kw}
def ellipse(left, top, rx, ry, fill='#fecaca', **kw):
    return {'type': 'Ellipse', 'uid': uid(), **C, 'left': left, 'top': top, 'rx': rx, 'ry': ry, 'fill': fill, 'stroke': '#7f1d1d', 'strokeWidth': 3, **kw}
def circle(left, top, r, fill='#bbf7d0', **kw):
    return {'type': 'Circle', 'uid': uid(), **C, 'left': left, 'top': top, 'radius': r, 'fill': fill, 'stroke': '#14532d', 'strokeWidth': 3, **kw}
def triangle(left, top, w, h, fill='#fde68a', **kw):
    return {'type': 'Triangle', 'uid': uid(), **C, 'left': left, 'top': top, 'width': w, 'height': h, 'fill': fill, 'stroke': '#78350f', 'strokeWidth': 3, **kw}
def line(x1, y1, x2, y2, color='#334155', width=6, **kw):
    return {'type': 'Line', 'uid': uid(), **C, 'left': (x1 + x2) / 2, 'top': (y1 + y2) / 2, 'x1': x1, 'y1': y1, 'x2': x2, 'y2': y2,
            'stroke': color, 'strokeWidth': width, **kw}
def scribble(cx, cy, color='#dc2626'):
    pts = [(cx - 200 + i * 10, cy + 60 * math.sin(i / 3)) for i in range(41)]
    path = [['M', *pts[0]]] + [['L', *p] for p in pts[1:]]
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    return {'type': 'Path', 'uid': uid(), **C, 'left': cx, 'top': cy, 'width': max(xs) - min(xs), 'height': max(ys) - min(ys),
            'pathOffset': {'x': (max(xs) + min(xs)) / 2, 'y': (max(ys) + min(ys)) / 2},
            'path': path, 'fill': None, 'stroke': color, 'strokeWidth': 8, 'strokeLineCap': 'round', 'strokeLineJoin': 'round'}
def card(t, left, top, fill='#e0e7ff'):
    """✋ card students drag: a rect and its label, both draggable"""
    return [rect(left, top, 260, 110, fill, studentDraggable=True), text(t, left, top, 44, 240, studentDraggable=True)]
def slide(objects, background='#ffffff'):
    return {'id': uid(), 'engine': 'fabric', 'width': W, 'height': H, 'background': background, 'objects': objects}

LESSON_MIME = 'application/vnd.colearn.lesson+zip'
def write(fname, lesson, media, extra=None):
    p = os.path.join(OUT, fname)
    with zipfile.ZipFile(p, 'w') as z:
        z.writestr(zipfile.ZipInfo('mimetype'), LESSON_MIME, zipfile.ZIP_STORED)  # first, uncompressed
        z.writestr(zipfile.ZipInfo('lesson.json'), json.dumps(lesson, ensure_ascii=False, indent=2), zipfile.ZIP_DEFLATED)
        for n, d in media.items(): z.writestr('media/' + n, d, zipfile.ZIP_STORED)
        for n, d in (extra or {}).items(): z.writestr(n, d)
    print(f'{fname:40s} {os.path.getsize(p) / 1e6:8.1f} MB  slides={sum(len(b.get("slides", [])) for b in lesson["blocks"])}')

# ---------- 1. drobi ----------
m = {
    'пирог 1-4.png': pie(4, 1), 'пирог 2-4.png': pie(4, 2), 'пирог 1-2.png': pie(2, 1, color=(16, 185, 129)),
    'пирог 3-8.png': pie(8, 3, color=(244, 63, 94)),
    'задача.png': card_png('Маша съела 3/8 пиццы,\nа Петя — 1/4.\nКто съел больше?\nНа сколько?'),
    'рынок.jpg': jpg(photo(1920, 1080, 1)),
    'рабочий лист.pdf': pdf(['1) 1/2 + 1/4 = ?\n2) 3/8 − 1/8 = ?\n3) Сравни 2/3 и 3/4', 'Ответы:\n1) 3/4\n2) 1/4\n3) 2/3 < 3/4']),
    'памятка.png': card_png('Чтобы сравнить дроби:\n1. Приведи к общему\n    знаменателю\n2. Сравни числители', bg=(236, 253, 245)),
}
drobi = {'version': 1, 'meta': {'title': 'Сравнение дробей', 'subject': 'Математика', 'grade': '5', 'author': 'Тестовый учитель', 'createdAt': '2026-11-02'},
  'blocks': [
    {'id': 'b1', 'type': 'group', 'title': 'Что такое доля', 'duration': 8,
     'teacherNote': 'Начать с вопроса: кто делил пиццу поровну? Показать круги по очереди, ответ открыть после обсуждения.',
     'attachments': [{'name': 'рабочий лист.pdf', 'kind': 'pdf'}],
     'slides': [
        slide([text('Сравнение дробей', 800, 380, 96, 1200, fontWeight='bold'), text('5 класс', 800, 520, 48, 600, fill='#64748b'),
               line(400, 450, 1200, 450, '#94a3b8', 4)], '#f8fafc'),
        slide([image('пирог 1-4.png', m, 450, 420, 420), image('пирог 2-4.png', m, 1150, 420, 420),
               text('Что больше?', 800, 80, 64, 800),
               text('2/4 = 1/2 — больше', 800, 790, 56, 900, fill='#16a34a', studentHidden=True),
               scribble(1150, 700)]),
        slide([circle(300, 450, 150), ellipse(800, 450, 220, 130), triangle(1300, 450, 300, 260),
               text('Фигуры тоже делятся на доли', 800, 100, 56, 1200), rect(800, 780, 900, 100, '#fef9c3')]),
     ]},
    {'id': 'b2', 'type': 'individual', 'title': 'Реши сам', 'duration': 7, 'task': 'Реши задачу на слайде, ответ запиши в тетрадь.',
     'teacherNote': 'Не подсказывать. Отметить, кто сравнивает «по числителям».', 'attachments': [{'name': 'памятка.png', 'kind': 'image'}],
     'slides': [slide([image('задача.png', m, 800, 450, 1100), image('пирог 3-8.png', m, 1400, 200, 260, angle=15),
                       text('Петя: 1/4 = 2/8 → Маша на 1/8 больше', 800, 830, 44, 1300, fill='#16a34a', studentHidden=True)])]},
    {'id': 'b3', 'type': 'pairs', 'title': 'Расставьте по порядку', 'duration': 8, 'technique': 'think-pair-share',
     'task': 'Перетащите карточки от меньшей дроби к большей. Объясните друг другу.',
     'teacherNote': 'Верный порядок: 1/8, 1/4, 3/8, 1/2, 3/4.', 'attachments': [],
     'slides': [slide([text('Меньше', 150, 820, 40, 200, fill='#64748b'), text('Больше', 1450, 820, 40, 200, fill='#64748b'),
                       line(250, 820, 1350, 820, '#94a3b8', 4),
                       *card('3/4', 300, 300), *card('1/8', 650, 200, '#fce7f3'), *card('1/2', 1000, 320), *card('3/8', 1300, 180, '#fce7f3'),
                       *card('1/4', 800, 480, '#dcfce7')])]},
    {'id': 'b4', 'type': 'fours', 'title': 'Дроби на рынке', 'duration': 10, 'technique': 'round-robin',
     'task': 'По кругу: каждый придумывает задачу про покупку на рынке с дробями. Остальные решают.',
     'teacherNote': 'Следить, чтобы говорил каждый. 2 минуты на человека.', 'attachments': [{'name': 'рынок.jpg', 'kind': 'image'}],
     'slides': [slide([image('рынок.jpg', m, 800, 450, 1600, pinned=True),
                       rect(800, 110, 1000, 130, '#ffffffcc'), text('Придумайте задачу про покупки', 800, 110, 52, 950),
                       *card('½ кг', 400, 600, '#fef3c7'), *card('¾ л', 800, 650, '#fef3c7'), *card('⅓ дыни', 1200, 600, '#fef3c7')])]},
  ]}
write('drobi.colesson', drobi, m)

# ---------- 2. heavy ----------
m = {f'фото {i:02d}.png': noise_png(1920, 1080, (random.randint(0, 255), random.randint(0, 255), random.randint(0, 255))) for i in range(1, 13)}
m['4k.png'] = noise_png(3840, 2160, (100, 100, 255))
m['пейзаж.jpg'] = jpg(photo(3840, 2160, 3), 95)
m['ролик.mp4'] = video('mp4', 30)
m['ролик.webm'] = video('webm', 10, '1280x720')
names = [n for n in m if n.startswith('фото')]
blocks = []
for bi, typ in enumerate(['group', 'individual', 'pairs', 'fours', 'group', 'pairs']):
    slides = []
    for si in range(7 if bi < 5 else 5):
        k = bi * 7 + si
        objs = [image(names[k % len(names)], m, 800, 450, 1600, pinned=True), text(f'Блок {bi + 1}, слайд {si + 1}', 800, 80, 64, 1000, backgroundColor='#ffffffcc')]
        if si % 3 == 1: objs.append(image(names[(k + 5) % len(names)], m, 1200, 600, 600, studentHidden=True))
        if si % 3 == 2: objs += card('тащи', 400, 700)
        slides.append(slide(objs))
    blocks.append({'id': f'h{bi}', 'type': typ, 'title': f'Тяжёлый блок {bi + 1}', 'duration': 5, 'teacherNote': '', 'task': 'Смотрим',
                   'technique': '', 'attachments': [], 'slides': slides})
blocks[0]['slides'].insert(0, slide([image('4k.png', m, 800, 450, 1600)]))
blocks[1]['slides'].insert(0, slide([image('пейзаж.jpg', m, 800, 450, 1600), text('JPEG 4K', 800, 800, 72, 600, fill='#fff')]))
blocks[0]['attachments'] = [{'name': 'ролик.mp4', 'kind': 'video'}, {'name': 'ролик.webm', 'kind': 'video'}]
write('heavy.colesson', {'version': 1, 'meta': {'title': 'Нагрузочный урок (тяжёлые медиа)', 'subject': 'Тест', 'grade': '', 'author': '', 'createdAt': '2026-11-02'}, 'blocks': blocks}, m)

# ---------- 3. edge ----------
m = {'круг.svg': svg(), 'анимация.gif': gif(), 'фото.webp': webp(),
     'Очень длинное имя файла с пробелами, (скобками) и ёлками 🎄 — версия 2 final FINAL.png': pie(3, 2),
     'UPPER.PNG': pie(6, 5, 200), 'не используется.png': pie(2, 2, 100)}  # last one: in archive, referenced nowhere
long_text = ' '.join(['Очень длинный текст, который должен переноситься по словам внутри текстового блока.'] * 12)
edge = {'version': 1, 'meta': {'title': '⚠️ Краевые случаи: эмодзи 🧪, <теги>, "кавычки" & амперсанд ' + 'x' * 120},
  'futureField': {'from': 'version 1.5'},  # unknown top-level field — must be ignored
  'blocks': [
    {'id': 'e1', 'type': 'group', 'title': 'Старый формат: поле scene', 'duration': 1, 'teacherNote': '', 'attachments': [],
     'scene': slide([text('Слайд из старого поля scene', 800, 450, 56, 1200)])},
    {'id': 'e2', 'type': 'group', 'title': 'Нет медиа в архиве', 'duration': 1, 'teacherNote': 'Должно быть предупреждение о пропавших файлах',
     'attachments': [{'name': 'пропал.pdf', 'kind': 'pdf'}],
     'slides': [slide([{'type': 'Image', 'uid': uid(), 'mediaName': 'пропала.png', **C, 'left': 800, 'top': 450, 'width': 800, 'height': 600},
                       text('Слева должна быть заглушка вместо картинки', 800, 820, 40, 1200)])]},
    {'id': 'e3', 'type': 'individual', 'title': 'SVG, GIF, WEBP, странные имена', 'duration': 1, 'task': '', 'teacherNote': '', 'attachments': [],
     'slides': [slide([image('круг.svg', m, 300, 300, 350), image('анимация.gif', m, 800, 300, 300), image('фото.webp', m, 1300, 300, 450),
                       image('Очень длинное имя файла с пробелами, (скобками) и ёлками 🎄 — версия 2 final FINAL.png', m, 500, 700, 250),
                       image('UPPER.PNG', m, 1100, 700, 200)])]},
    {'id': 'e4', 'type': 'pairs', 'title': 'Трансформации и выход за края', 'duration': 1, 'task': '', 'technique': 'unknown-technique', 'teacherNote': '', 'attachments': [],
     'slides': [slide([rect(800, 450, 400, 200, angle=30), rect(800, 450, 400, 200, '#fca5a5', flipX=True, angle=-30, opacity=0.5),
                       ellipse(-50, -50, 200, 120), circle(1650, 950, 150), text('Повёрнутый текст', 300, 700, 48, 500, angle=-90),
                       rect(1300, 200, 200, 200, '#a7f3d0', skewX=25, scaleX=1.5),
                       {'type': 'Rect', 'uid': uid(), **C, 'left': 1300, 'top': 700, 'width': 150, 'height': 150, 'fill': '#000', 'unknownProp': 42, 'visible': True}],
                      '#1e293b')]},
    {'id': 'e5', 'type': 'fours', 'title': '', 'duration': 0, 'task': long_text, 'technique': '', 'teacherNote': long_text, 'attachments': [], 'slides': []},
    {'id': 'e6', 'type': 'group', 'title': 'Пустой слайд и слайд из одних скрытых', 'duration': 1, 'teacherNote': '', 'attachments': [],
     'slides': [slide([]), slide([text('Видит только учитель', 800, 450, 64, 1000, studentHidden=True),
                                  rect(800, 650, 300, 100, studentHidden=True, studentDraggable=True)])]},
    {'id': 'e7', 'type': 'group', 'title': 'Длинный текст ' * 10, 'duration': 120, 'teacherNote': '', 'attachments': [],
     'slides': [slide([text(long_text, 800, 450, 32, 1400, textAlign='left')])]},
    {'id': 'e8', 'type': 'group', 'title': 'Много объектов (500)', 'duration': 1, 'teacherNote': '', 'attachments': [],
     'slides': [slide([circle(random.randint(0, W), random.randint(0, H), random.randint(5, 40),
                              f'#{random.randint(0, 0xFFFFFF):06x}', studentDraggable=random.random() < 0.2) for _ in range(500)])]},
  ]}
write('edge.colesson', edge, m)

# ---------- 4. broken ----------
open(os.path.join(OUT, 'broken-not-zip.colesson'), 'wb').write(b'this is not a zip at all')
def broken(fname, entries):
    with zipfile.ZipFile(os.path.join(OUT, fname), 'w') as z:
        mt = entries.pop('mimetype', LESSON_MIME)
        if mt is not None: z.writestr(zipfile.ZipInfo('mimetype'), mt, zipfile.ZIP_STORED)
        for n, d in entries.items(): z.writestr(n, d)
    print(fname)
broken('broken-no-json.colesson', {'media/a.png': pie(2, 1, 100)})
broken('broken-bad-json.colesson', {'lesson.json': '{"version": 1, "blocks": [ oops'})
broken('broken-no-mimetype.colesson', {'mimetype': None, 'lesson.json': json.dumps({'version': 1, 'meta': {}, 'blocks': []})})  # plain zip with a lesson inside
broken('broken-other-mimetype.colesson', {'mimetype': 'application/epub+zip', 'lesson.json': json.dumps({'version': 1, 'meta': {}, 'blocks': []})})
broken('broken-version-2.colesson', {'lesson.json': json.dumps({'version': 2, 'meta': {}, 'blocks': []})})
