#!/usr/bin/env python3
"""Measure bright-pixel density inside each stop heading card region.
Captures a screenshot at a given scroll and analyzes the card rect via PIL.
Usage: measure_card.py <which: before|after> <stop-index 1-5>
"""
import json, subprocess, sys, time, base64, io
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9229
STOP = int(sys.argv[2]) if len(sys.argv) > 2 else 4

proc = subprocess.Popen([
    CHROME, "--headless=new", "--hide-scrollbars",
    f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1440,900", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=/tmp/cdp-measure",
    "http://localhost:3000/",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    import urllib.request
    page = None
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            cand = [t for t in tabs if t.get("type") == "page"]
            if cand: page = cand[0]; break
        except Exception: pass
        time.sleep(0.2)
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
    mid = [0]
    def cmd(method, **params):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid[0]: return msg.get("result", {})
    cmd("Runtime.enable"); cmd("Page.enable")
    time.sleep(4.5)
    cmd("Runtime.evaluate", expression="document.querySelectorAll('.landing-reveal').forEach(el=>el.classList.add('landing-in'))")
    time.sleep(0.5)
    # scroll the Nth stop's heading card into a stable position (same as shots: stop top - 150)
    res = cmd("Runtime.evaluate", returnByValue=True, expression=f"""(() => {{
      const stops = [...document.querySelectorAll('.landing-stop')];
      const st = stops[{STOP-1}];
      const y = Math.round(st.getBoundingClientRect().top + window.scrollY) - 150;
      return JSON.stringify({{y}});
    }})()""")
    y = json.loads(res["result"]["value"])["y"]
    cmd("Runtime.evaluate", expression=f"window.scrollTo(0, {y})")
    time.sleep(2.2)
    # rect of the heading card in viewport coords (before screenshot we can't get the old card;
    # for 'before' we use the title element's rect as the proxy region)
    sel = ".landing-stop-head" 
    res = cmd("Runtime.evaluate", returnByValue=True, expression=f"""(() => {{
      const st = [...document.querySelectorAll('.landing-stop')][{STOP-1}];
      const el = st.querySelector('{sel}') || st.querySelector('.landing-stop-title');
      const r = el.getBoundingClientRect();
      return JSON.stringify({{x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height)}});
    }})()""")
    rect = json.loads(res["result"]["value"])
    shot = cmd("Page.captureScreenshot", format="png")
    png = base64.b64decode(shot["data"])
    ws.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()

from PIL import Image
img = Image.open(io.BytesIO(png)).convert("RGB")
x, y0, w, h = rect["x"], rect["y"], rect["w"], rect["h"]
crop = img.crop((x, y0, x + w, y0 + h))
px = crop.load()
total = w * h
bright = sum(1 for i in range(w) for j in range(h) if px[i, j][2] > 120 and px[i, j][2] - px[i, j][0] > 30)
# blue-ish bright particle pixels
print(json.dumps({"stop": STOP, "region": rect, "total_px": total, "blue_bright_px": bright, "density_pct": round(100*bright/total, 3)}))
crop.save(f".multica/shots/measure-stop{STOP}-region.png")
