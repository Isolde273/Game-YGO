from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from collections import deque

assets = Path(__file__).resolve().parents[1] / 'public' / 'assets'
title = Image.open(assets / 'locr-lid-title-source.png').convert('RGB')
width, height = title.size
ink = Image.new('L', title.size)
outline = Image.new('L', title.size)
ImageDraw.Draw(outline).polygon([
    (93, 0), (198, 0), (218, 13), (223, 29), (216, 43),
    (229, 53), (227, 70), (217, 83), (73, 83), (72, 66),
    (91, 54), (78, 39), (81, 18),
], fill=255)
for y in range(height):
    for x in range(width):
        r, g, b = title.getpixel((x, y))
        japanese = y < 84 and outline.getpixel((x, y)) and g < 162 and b < 125
        english = 85 <= y < 134 and g < 185 and b < 160
        if japanese or english:
            ink.putpixel((x, y), 255)

# Join the logo's dark outline, then retain its gold interior without foil outside.
japanese = ink.crop((0, 0, width, 84)).filter(ImageFilter.MaxFilter(3)).filter(ImageFilter.MinFilter(3))
outside = set()
queue = deque([(x, y) for x in range(width) for y in [0, 83]] + [(x, y) for y in range(84) for x in [0, width - 1]])
while queue:
    x, y = queue.popleft()
    if x < 0 or x >= width or y < 0 or y >= 84 or (x, y) in outside or japanese.getpixel((x, y)):
        continue
    outside.add((x, y))
    queue.extend([(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)])
for y in range(84):
    for x in range(width):
        if (x, y) not in outside:
            ink.putpixel((x, y), 255)
ink = ink.filter(ImageFilter.MaxFilter(3))
shape = Image.new('L', title.size)
shape_draw = ImageDraw.Draw(shape)
shape_draw.polygon([(108, 2), (133, 7), (159, 3), (184, 3), (198, 9),
                    (218, 13), (218, 29), (210, 36), (195, 42), (209, 45),
                    (209, 52), (109, 57), (94, 53), (84, 44), (86, 29),
                    (99, 23), (99, 14)], fill=255)
shape_draw.rectangle((122, 0, 208, 9), fill=255)
shape_draw.rectangle((98, 52, 212, 64), fill=255)
shape_draw.polygon([(82, 63), (215, 63), (221, 68), (230, 66), (229, 77),
                    (218, 82), (203, 79), (197, 84), (157, 80), (124, 84),
                    (111, 79), (94, 83), (76, 79), (78, 68), (85, 69)], fill=255)
for y in range(height):
    for x in range(width):
        if not shape.getpixel((x, y)) or y >= 85:
            ink.putpixel((x, y), 0)
# Remove isolated foil specks without changing the connected wordmark.
remaining = {(x, y) for y in range(84) for x in range(width) if ink.getpixel((x, y))}
while remaining:
    queue = deque([remaining.pop()])
    component = []
    while queue:
        x, y = queue.popleft()
        component.append((x, y))
        for neighbour in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)]:
            if neighbour in remaining:
                remaining.remove(neighbour)
                queue.append(neighbour)
    if len(component) < 10:
        for point in component:
            ink.putpixel(point, 0)
logo = title.convert('RGBA')
logo.putalpha(ink)
# The supplied photograph clips the last letter and includes foil flares in the
# English lettering. Restore the same serif wordmark on a transparent surface.
font_path = Path('C:/Windows/Fonts/timesbd.ttf')
font = ImageFont.truetype(str(font_path) if font_path.exists() else 'DejaVuSerif.ttf', 80)
def lettering(text, size):
    box = font.getbbox(text, stroke_width=1)
    image = Image.new('RGBA', (box[2] - box[0] + 4, box[3] - box[1] + 4))
    ImageDraw.Draw(image).text((2 - box[0], 2 - box[1]), text, font=font,
                              fill=(65, 46, 20, 255), stroke_width=1,
                              stroke_fill=(188, 153, 77, 255))
    return image.resize(size, Image.Resampling.LANCZOS)
logo.alpha_composite(lettering('LIMIT OVER COLLECTION', (295, 28)), (5, 86))
logo.alpha_composite(lettering('THE RIVALS', (141, 17)), (82, 118))
rules = ImageDraw.Draw(logo)
rules.line((5, 126, 78, 126), fill=(85, 82, 76, 255), width=2)
rules.line((227, 126, 300, 126), fill=(85, 82, 76, 255), width=2)
logo.save(assets / 'locr-lid-title.png')

source = Image.open(assets / 'locr-konami-source.png').convert('RGB')
mask = Image.new('L', source.size)
for y in range(source.height):
    for x in range(source.width):
        r, g, b = source.getpixel((x, y))
        if r > 105 and g < r * 0.72 and b < r * 0.72:
            mask.putpixel((x, y), min(255, max(r - g, r - b) * 4))
konami = source.convert('RGBA')
konami.putalpha(mask)
konami = konami.crop(mask.getbbox())
konami.save(assets / 'locr-konami.png')

lid = Image.new('RGBA', (600, 500), (248, 248, 246, 255))
brand = konami.resize((150, round(konami.height * 150 / konami.width)), Image.Resampling.LANCZOS)
lid.alpha_composite(brand, (28, 25))
print_logo = logo.resize((500, round(height * 500 / width)), Image.Resampling.LANCZOS)
lid.alpha_composite(print_logo, (50, 150))
lid.convert('RGB').save(assets / 'locr-box-top.png')
