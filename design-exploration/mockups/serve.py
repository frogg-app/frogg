"""Static server for the mockups + POST /feedback/<round> to persist notes to <round>/feedback.json."""
import json, os, re, sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))

class H(SimpleHTTPRequestHandler):
    def __init__(self, *a, **k): super().__init__(*a, directory=ROOT, **k)
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def do_POST(self):
        m = re.fullmatch(r'/feedback/(round-\d+)', self.path)
        if not m or not os.path.isdir(os.path.join(ROOT, m.group(1))):
            self.send_error(404); return
        body = self.rfile.read(min(int(self.headers.get('Content-Length', 0)), 200_000))
        try: data = json.loads(body)
        except Exception: self.send_error(400); return
        with open(os.path.join(ROOT, m.group(1), 'feedback.json'), 'w') as f: json.dump(data, f, indent=2)
        self.send_response(204); self.end_headers()

ThreadingHTTPServer(('127.0.0.1', int(sys.argv[1])), H).serve_forever()
