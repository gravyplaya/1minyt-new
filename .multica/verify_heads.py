#!/usr/bin/env python3
"""Verify computed styles of every .landing-stop-head + .landing-final-card."""
import json, subprocess, time
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9225

proc = subprocess.Popen([
    CHROME, "--headless=new", "--hide-scrollbars",
    f"--remote-debugging-port={PORT}", "--remote-allow-origins=*",
    "--window-size=1440,900", "--no-first-run", "--no-default-browser-check",
    "--user-data-dir=/tmp/cdp-verify",
    "http://localhost:3000/",
], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    import urllib.request
    page = None
    for _ in range(50):
        try:
            tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
            cand = [t for t in tabs if t.get("type") == "page"]
            if cand:
                page = cand[0]; break
        except Exception:
            pass
        time.sleep(0.2)
    ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
    mid = [0]
    def cmd(method, **params):
        mid[0] += 1
        ws.send(json.dumps({"id": mid[0], "method": method, "params": params}))
        while True:
            msg = json.loads(ws.recv())
            if msg.get("id") == mid[0]:
                return msg.get("result", {})
    cmd("Runtime.enable")
    time.sleep(3)
    res = cmd("Runtime.evaluate", returnByValue=True, expression="""(() => {
      const pick = (el) => {
        const s = getComputedStyle(el);
        return {
          bg: s.backgroundColor, blur: s.backdropFilter || s.webkitBackdropFilter,
          radius: s.borderRadius, w: Math.round(el.getBoundingClientRect().width),
          h: Math.round(el.getBoundingClientRect().height),
        };
      };
      return JSON.stringify({
        heads: [...document.querySelectorAll('.landing-stop-head')].map(pick),
        final: pick(document.querySelector('.landing-final-card')),
        hero: pick(document.querySelector('.landing-hero-content')),
      });
    })()""")
    print(res["result"]["value"])
    ws.close()
finally:
    proc.terminate()
    try: proc.wait(timeout=5)
    except Exception: proc.kill()
