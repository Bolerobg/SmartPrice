
import sys, re, urllib.request, gzip, io
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Language": "bg-BG,bg;q=0.9"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read()
        if raw[:2] == b"\x1f\x8b":
            raw = gzip.decompress(raw)
        return r.status, raw.decode("utf-8", "replace")

for child in ["https://sopharmacy.bg/media/sys_master/h16/hea/9346072150046.xml",
              "https://sopharmacy.bg/media/sys_master/h86/h5d/9346072215582.xml"]:
    st, xml = get(child)
    locs = re.findall(r"<loc>\s*([^<\s]+)", xml)
    print("=" * 70)
    print(child.split("/")[-1], "| HTTP", st, "|", len(xml), "знака | loc:", len(locs))
    for u in locs[:6]:
        print("   ", u)
    # колко изглеждат продукти (слаг с тирета) и колко категории
    prod = [u for u in locs if re.search(r"/(?:product|produkt|item|goods|tovar|p)/", u, re.I)]
    slug = [u for u in locs if re.search(r"^[a-z0-9]+(?:-[a-z0-9]+)+$", u.rstrip("/").rsplit("/", 1)[-1], re.I)]
    print("   с /product/:", len(prod), "| слаг с тирета:", len(slug))
