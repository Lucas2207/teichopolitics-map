#!/usr/bin/env python3
"""Bring every cost on the map to the latest month published for both US CPI-U and euro-area HICP.

Run daily by .github/workflows/update-prices.yml. It does nothing until a new month is available
for both indices. Figures are recalculated from data/price-base.json rather than from the previous
output, so rounding never accumulates. A text edited by hand, or a new record, is picked up as a
new base at the month named in its own text ("in September 2026 prices").
"""
import argparse, datetime, json, re, sys, urllib.request

MONTHS = "January February March April May June July August September October November December".split()
PRICE = re.compile(r"in ((?:%s) \d{4}) prices" % "|".join(MONTHS))
TOKEN = re.compile(r"(?P<pre>≈ |[Oo]ver |about )?(?P<cur>[$€])(?P<n>\d[\d,]*(?:\.\d+)?)(?P<u> billion| million)?"
                   r"|(?<=; )(?P<bare>\d+\.\d+)(?P<bu> billion| million)")
BARRIERS, BASE, INDEX, HTML = "data/barriers.geojson", "data/price-base.json", "data/price-index.json", "index.html"


def label(month):
    y, m = month.split("-")
    return f"{MONTHS[int(m) - 1]} {y}"


def to_month(text):
    name, y = text.split()
    return f"{y}-{MONTHS.index(name) + 1:02d}"


def get(url, data=None, headers=None):
    req = urllib.request.Request(url, data=data, headers={"User-Agent": "teichopolitics-map price update", **(headers or {})})
    with urllib.request.urlopen(req, timeout=90) as r:
        return json.load(r)


def fetch():
    """Monthly values of both indices. Raises on any failure, so nothing is half-updated."""
    year = datetime.date.today().year
    body = json.dumps({"seriesid": ["CUUR0000SA0"], "startyear": str(year - 2), "endyear": str(year)}).encode()
    bls = get("https://api.bls.gov/publicAPI/v1/timeseries/data/", body, {"Content-Type": "application/json"})
    if bls.get("status") != "REQUEST_SUCCEEDED":
        raise RuntimeError(f"BLS: {bls.get('message')}")
    usd = {f"{r['year']}-{r['period'][1:]}": float(r["value"]) for r in bls["Results"]["series"][0]["data"]
           if r["period"] != "M13" and r["value"] != "-"}
    h = get("https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/prc_hicp_minr?format=JSON&geo=EA&unit=I25"
            f"&coicop18=TOTAL&sinceTimePeriod={year - 2}-01")
    eur = {m: h["value"][str(i)] for m, i in h["dimension"]["time"]["category"]["index"].items() if str(i) in h["value"]}
    if not usd or not eur:
        raise RuntimeError("an index came back empty")
    return {m: {"usd": usd[m], "eur": eur[m]} for m in usd if m in eur}


def number(value, cur, sample, unit, rate):
    v = value * rate
    dec = len(sample.split(".")[1]) if "." in sample else 0
    if unit == " million" and v >= 1000:
        return f"{cur}{v / 1000:.2f} billion"
    if unit:
        return f"{cur}{v:.{dec}f}{unit}"
    return f"{cur}{round(v, -3):,.0f}"


def scale(text, usd, eur, head):
    last = [None]

    def sub(m):
        if m["bare"]:
            if not head or not last[0]:
                return m[0]
            return number(float(m["bare"]), "", m["bare"], m["bu"], usd if last[0] == "$" else eur)
        pre = m["pre"] or ""
        if not pre or (pre != "≈ " and not head):
            return m[0]
        last[0] = m["cur"]
        return pre + number(float(m["n"].replace(",", "")), m["cur"], m["n"], m["u"], usd if m["cur"] == "$" else eur)

    return TOKEN.sub(sub, text)


def render(text, month, target, hist):
    """The text written in `month` prices, restated in `target` prices. Original figures are never touched."""
    if month == target:
        return text
    usd = hist[target]["usd"] / hist[month]["usd"]
    eur = hist[target]["eur"] / hist[month]["eur"]
    if "Original:" in text:
        h, t = text.split("Original:", 1)
        out = scale(h, usd, eur, True) + "Original:" + scale(t, usd, eur, False)
    else:
        out = scale(text, usd, eur, False)
    return out.replace(f"in {label(month)} prices", f"in {label(target)} prices")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fake", nargs=3, metavar=("MONTH", "USD", "EUR"), help="test with a made-up month instead of fetching")
    args = ap.parse_args()
    state = json.load(open(INDEX, encoding="utf8"))
    hist = state["history"]
    if args.fake:
        hist[args.fake[0]] = {"usd": float(args.fake[1]), "eur": float(args.fake[2])}
    else:
        hist.update(fetch())
    current, latest = state["month"], max(hist)
    if latest <= current:
        print(f"No new month: costs stay in {label(current)} prices.")
        return 0
    base = json.load(open(BASE, encoding="utf8"))
    lines = open(BARRIERS, encoding="utf8").read().split("\n")
    changed = 0
    for i, line in enumerate(lines):
        s = line.strip().rstrip(",")
        if not s.startswith('{"type": "Feature"'):
            continue
        feat = json.loads(s)
        props, name, edited = feat["properties"], feat["properties"]["name"], False
        for key, val in list(props.items()):
            ref = f"{name}|{key}"
            if isinstance(val, str) and PRICE.search(val):
                entry = base.get(ref)
                if not entry or render(entry["text"], entry["month"], current, hist) != val:
                    entry = base[ref] = {"month": to_month(PRICE.search(val)[1]), "text": val}
                new = render(entry["text"], entry["month"], latest, hist)
            elif isinstance(val, (int, float)) and re.match(r"(cost|maintenance)_(usd|eur)_current$", key):
                cur = key.split("_")[1]
                entry = base.get(ref)
                ratio = lambda t: hist[t][cur] / hist[entry["month"]][cur]
                if not entry or round(entry["value"] * ratio(current)) != val:
                    entry = base[ref] = {"month": current, "value": val}
                new = round(entry["value"] * ratio(latest))
            else:
                continue
            if new != val:
                props[key], edited = new, True
        if edited:
            tail = "," if line.rstrip().endswith(",") else ""
            indent = line[: len(line) - len(line.lstrip())]
            lines[i] = indent + json.dumps(feat, ensure_ascii=False, separators=(", ", ": ")) + tail
            changed += 1
    raw = "\n".join(lines)
    json.loads(raw)  # refuse to write anything that is not valid
    open(BARRIERS, "w", encoding="utf8").write(raw)
    json.dump(base, open(BASE, "w", encoding="utf8"), ensure_ascii=False, indent=0)
    page = open(HTML, encoding="utf8").read()
    open(HTML, "w", encoding="utf8").write(re.sub(r"Costs are in [A-Z][a-z]+ \d{4} prices\.", f"Costs are in {label(latest)} prices.", page))
    state["month"] = latest
    json.dump(state, open(INDEX, "w", encoding="utf8"), indent=1)
    print(f"Costs moved from {label(current)} to {label(latest)} prices ({changed} records).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
