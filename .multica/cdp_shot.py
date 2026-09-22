#!/usr/bin/env python3
"""Screenshot the landing page at arbitrary scroll positions via CDP.
Usage: cdp_shot.py <url> <out.png> <scroll_y> [window_size]
"""
import json, subprocess, sys, time, base64, zlib
import websocket

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
PORT = 9223

def main():
    url, out, scroll_y = sys.argv[1], sys.argv[2], int(sys.argv[3])
    size = sys.argv[4] if len(sys.argv) > 4 else "1440,900"
    proc = subprocess.Popen([
        CHROME, "--headless=new", "--hide-scrollbars",
        f"--remote-debugging-port={PORT}",
        "--remote-allow-origins=*",
        f"--window-size={size}", "--no-first-run", "--no-default-browser-check",
        "--user-data-dir=/tmp/cdp-shot-profile",
        url,
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        # wait for devtools
        import urllib.request
        for _ in range(50):
            try:
                tabs = json.load(urllib.request.urlopen(f"http://127.0.0.1:{PORT}/json"))
                page = [t for t in tabs if t.get("type") == "page"]
                if page: break
            except Exception:
                pass
            time.sleep(0.2)
        ws_url = page[0]["webSocketDebuggerUrl"]
        ws = websocket.create_connection(ws_url, timeout=30)
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
        time.sleep(4)  # let the scene boot
        # scroll
        cmd("Runtime.evaluate", expression=f"window.scrollTo(0, {scroll_y})")
        time.sleep(2.5)  # let morph settle + reveals fire
        # force reveals visible (scrolling via scrollTo may skip IntersectionObserver for hero)
        cmd("Runtime.evaluate", expression="document.querySelectorAll('.landing-reveal').forEach(el=>el.classList.add('landing-in'))")
        time.sleep(0.8)
        shot = cmd("Page.captureScreenshot", format="png")
        with open(out, "wb") as f:
            f.write(base64.b64decode(shot["data"]))
        print(f"saved {out} at scroll_y={scroll_y}")
        ws.close()
    finally:
        proc.terminate()
        try: proc.wait(timeout=5)
        except Exception: proc.kill()

if __name__ == "__main__":
    main()
