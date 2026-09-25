#!/usr/bin/env python3
"""Screenshot every landing stop heading + stats strip + final CTA in one session.
Usage: stop_shots.py <outdir> [url] [window_size]
"""
import json, subprocess, sys, time, base64
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9224
URL = sys.argv[2] if len(sys.argv) > 2 else "http://localhost:3000/"
SIZE = sys.argv[3] if len(sys.argv) > 3 else "1440,900"

def main():
    outdir = sys.argv[1]
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--hide-scrollbars",
        f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",
        f"--window-size={SIZE}", "--no-first-run", "--no-default-browser-check",
        "--user-data-dir=/tmp/cdp-stopshots",
        URL,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        import urllib.request
        page = None
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                cand = [t for t in tabs if t.get("type") == "page"]
                if cand:
                    page = cand[0]
                    break
            except Exception:
                pass
            time.sleep(0.2)
        ws = websocket.create_connection(page["webSocketDebuggerUrl"], timeout=30)
        mid = 0
        def cmd(method, **params):
            nonlocal mid
            mid += 1
            ws.send(json.dumps({"id": mid, "method": method, "params": params}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == mid:
                    return msg.get("result", {})
        cmd("Runtime.enable")
        cmd("Page.enable")
        time.sleep(4.5)  # scene boot
        cmd("Runtime.evaluate", expression="document.querySelectorAll('.landing-reveal').forEach(el=>el.classList.add('landing-in'))")
        time.sleep(0.5)
        res = cmd("Runtime.evaluate", returnByValue=True, expression="""JSON.stringify({
          stops: [...document.querySelectorAll('.landing-stop')].map(e=>Math.round(e.getBoundingClientRect().top + window.scrollY)),
          final: Math.round(document.querySelector('.landing-final').getBoundingClientRect().top + window.scrollY),
          stats: Math.round(document.querySelector('.landing-stats').getBoundingClientRect().top + window.scrollY),
          height: document.documentElement.scrollHeight
        })""")
        data = json.loads(res["result"]["value"])
        print("page height:", data["height"])
        shots = [("stats", data["stats"] - 200)]
        shots += [(f"stop{i+1}", t - 150) for i, t in enumerate(data["stops"])]
        shots += [("final", data["final"] - 200)]
        for name, y in shots:
            cmd("Runtime.evaluate", expression=f"window.scrollTo(0, {max(0, int(y))})")
            time.sleep(2.2)  # morph settle
            shot = cmd("Page.captureScreenshot", format="png")
            with open(f"{outdir}/{name}.png", "wb") as f:
                f.write(base64.b64decode(shot["data"]))
            print(f"saved {outdir}/{name}.png scroll={int(y)}")
        ws.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except Exception:
            proc.kill()

if __name__ == "__main__":
    main()
