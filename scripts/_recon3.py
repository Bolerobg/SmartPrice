
import sys
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
sys.path.insert(0, r"C:\Dockers\SmartPrice\scripts")
import scrape_local as S

for u in ["https://sopharmacy.bg/bg/sitemap.xml",
          "https://sopharmacy.bg/media/sys_master/h16/hea/9346072150046.xml"]:
    st, raw, final = S.fetch(u, verbose=True)
    print("FETCH", u.split("/")[-1], "->", st, "|", len(raw), "знака | loc:", raw.count("<loc>"))
    print("   индекс:", "<sitemapindex" in raw.lower(), "| първи адреси:", S.locs(raw)[:2])
print("--- sitemap_urls ---")
print(S.sitemap_urls("https://sopharmacy.bg/"))
print("--- какво събира ---")
urls = S.collect_product_urls("https://sopharmacy.bg/", 240, verbose=True)
print("събрани:", len(urls), urls[:4])
