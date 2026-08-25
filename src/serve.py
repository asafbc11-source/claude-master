# -*- coding: utf-8 -*-
"""Static server for local preview.

Threaded so parallel browser connections don't reset mid-transfer, and it skips
getfqdn(), which fails when the machine name contains non-ASCII characters.
"""
import functools, os, socketserver
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PORT = 8321

class Srv(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True
    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name = "localhost"
        self.server_port = self.server_address[1]

class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        # always serve the freshest build during development
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()

handler = functools.partial(Handler, directory=ROOT)
print("serving", ROOT, "on http://localhost:%d" % PORT)
Srv(("127.0.0.1", PORT), handler).serve_forever()
