"""Draw the Ave·Dex app icons (the device's glowing lens) into icons/.

    python3 scripts/make_icons.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT = Path(__file__).resolve().parent.parent / "icons"
SHELL, SHELL_DARK, SHELL_LIGHT = (29, 77, 70), (18, 54, 49), (42, 106, 96)
BEZEL, AMBER, AMBER_DARK, AMBER_LIGHT = (217, 212, 195), (240, 166, 58), (163, 90, 12), (255, 233, 176)


def radial(size, inner, outer, center, radius):
    img = Image.new("RGB", (size, size), outer)
    d = ImageDraw.Draw(img)
    steps = 120
    for i in range(steps, 0, -1):
        t = i / steps
        r = radius * t
        col = tuple(int(inner[k] + (outer[k] - inner[k]) * t) for k in range(3))
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r], fill=col)
    return img


def draw(size, padding=0.0):
    S = size * 4  # supersample
    img = radial(S, SHELL_LIGHT, SHELL_DARK, (S * 0.3, S * 0.25), S * 1.1)
    d = ImageDraw.Draw(img)
    scale = 1 - padding
    c = S / 2
    cy = S * (0.5 - 0.06 * scale)  # lens sits a little high, LEDs below
    R = S * 0.27 * scale
    # glow
    glow = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse([c - R * 1.35, cy - R * 1.35, c + R * 1.35, cy + R * 1.35], fill=AMBER + (110,))
    img.paste(glow.filter(ImageFilter.GaussianBlur(S * 0.05)), (0, 0), glow.filter(ImageFilter.GaussianBlur(S * 0.05)))
    d = ImageDraw.Draw(img)
    # dark ring, bezel, lens
    for rr, col in ((R * 1.22, SHELL_DARK), (R * 1.14, BEZEL)):
        d.ellipse([c - rr, cy - rr, c + rr, cy + rr], fill=col)
    lens = radial(int(2 * R), AMBER_LIGHT, AMBER_DARK, (R * 0.7, R * 0.7), R * 1.6)
    mask = Image.new("L", lens.size, 0)
    ImageDraw.Draw(mask).ellipse([0, 0, lens.size[0] - 1, lens.size[1] - 1], fill=255)
    img.paste(lens, (int(c - R), int(cy - R)), mask)
    # glint
    d = ImageDraw.Draw(img)
    gx, gy = c - R * 0.42, cy - R * 0.45
    d.ellipse([gx - R * 0.22, gy - R * 0.14, gx + R * 0.22, gy + R * 0.14], fill=(255, 255, 255))
    # three status LEDs
    for i, col in enumerate([(224, 87, 75), (241, 208, 75), (111, 207, 106)]):
        lr = S * 0.035 * scale
        lx = c + (i - 1) * lr * 3.2
        ly = cy + R * 1.55
        d.ellipse([lx - lr - S * 0.008, ly - lr - S * 0.008, lx + lr + S * 0.008, ly + lr + S * 0.008], fill=SHELL_DARK)
        d.ellipse([lx - lr, ly - lr, lx + lr, ly + lr], fill=col)
    return img.resize((size, size), Image.LANCZOS)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    draw(180).save(OUT / "apple-touch-icon.png")
    draw(192).save(OUT / "icon-192.png")
    draw(512).save(OUT / "icon-512.png")
    draw(512, padding=0.18).save(OUT / "icon-maskable-512.png")
    draw(32).save(OUT / "favicon-32.png")
    print("icons written to", OUT)
