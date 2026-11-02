"""Render the original code-native Humanity mark. GPL-3.0-or-later."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
DEST = ROOT / 'assets'

def main():
    DEST.mkdir(exist_ok=True)
    image = Image.new('RGBA', (1024, 1024), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((20, 20, 1004, 1004), 224, fill='#111c23')
    draw.rounded_rectangle((132, 160, 812, 816), 86, fill='#285359')
    draw.rounded_rectangle((174, 122, 854, 778), 86, fill='#548f8c')
    draw.rounded_rectangle((216, 84, 896, 740), 86, fill='#b3e4d6')
    draw.rounded_rectangle((270, 138, 842, 683), 51, fill='#19323b')
    draw.rounded_rectangle((334, 232, 416, 592), 21, fill='#b3e4d6')
    draw.rounded_rectangle((688, 232, 770, 592), 21, fill='#b3e4d6')
    draw.rounded_rectangle((376, 372, 730, 454), 21, fill='#b3e4d6')
    draw.ellipse((640, 634, 958, 952), fill='#f0b478', outline='#111c23', width=22)
    draw.polygon(((766, 706), (766, 882), (874, 794)), fill='#17272f')
    image.save(DEST / 'icon.png', optimize=True)
    image.save(DEST / 'icon.ico', sizes=[(s, s) for s in (16, 24, 32, 48, 64, 128, 256)])
    image.save(DEST / 'icon.icns', format='ICNS')
    print(DEST)

if __name__ == '__main__':
    main()
