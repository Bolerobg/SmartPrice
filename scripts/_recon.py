
import sys, re, urllib.request
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"

def get(url):
    req = urllib.request.Request(url, headers={
        "User-Agent": UA, "Accept-Language": "bg-BG,bg;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status, r.read().decode("utf-8", "replace")

st, rb = get("https://sopharmacy.bg/robots.txt")
print("robots:", st)
for line in rb.splitlines():
    if re.search(r"sitemap", line, re.I):
        print("  ", line.strip())

st, xml = get("https://sopharmacy.bg/bg/sitemap.xml")
print("\nsitemap.xml:", st, len(xml), "знака | индекс:", bool(re.search(r"<sitemapindex", xml, re.I)))
locs = re.findall(r"<loc>\s*([^<\s]+)", xml)
print("loc общо:", len(locs))
for u in locs[:25]:
    print("  ", u)
