"""Cuts the place backgrounds out of the Near Mint landscape sheets (Max's own card game) into assets/places/.

Each Near Mint "full" sheet is 1920x1600: a 6x5 grid of 320px card arts. PICKS says which art each place uses.
Usage: python3 tools/place_art.py <dir with the downloaded sheets>
       (sheets: https://near-mint-maxwelltrendas-projects.vercel.app/art/full/<set>-f<n>.webp)
"""
import os, sys
from PIL import Image

PICKS = {   # place id: (sheet, index on the sheet)
    'meadow': ('longroad-f1.webp', 22), 'woods': ('landscapes-f1.webp', 26), 'banks': ('longroad-f2.webp', 26),
    'quarry': ('longroad-f5.webp', 22), 'beach': ('worldsedge-f1.webp', 6), 'highlands': ('longroad-f6.webp', 18),
    'mine': ('longroad-f2.webp', 12), 'pond': ('worldsedge-f6.webp', 2), 'river': ('landscapes-f1.webp', 22),
    'cove': ('longroad-f0.webp', 6), 'tarn': ('landscapes-f5.webp', 16),
}
src = sys.argv[1]
out = os.path.join(os.path.dirname(__file__), '..', 'assets', 'places')
os.makedirs(out, exist_ok=True)
for pid, (sheet, i) in PICKS.items():
    im = Image.open(os.path.join(src, sheet)).convert('RGB')
    c, r = i % 6, i // 6
    im.crop((c * 320, r * 320, c * 320 + 320, r * 320 + 320)).save(os.path.join(out, pid + '.webp'), quality=84, method=6)
    print(pid, os.path.getsize(os.path.join(out, pid + '.webp')))
