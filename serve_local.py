"""Local mirror server: isolation headers, byte ranges, and engine batch I/O."""
import argparse, gzip, io, json, mimetypes, re, shutil, webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.parse import urlsplit, unquote, parse_qs

PROJECT = Path(__file__).resolve().parent
ROOT = PROJECT / 'mirror' / 'playgta5.com'
PAGES_ORIGIN = 'https://gta-web-ipad.pages.dev'
class NoRedirectHandler(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, new_url):
        return None

ZIP_OPENER = build_opener(NoRedirectHandler)
mimetypes.add_type('application/wasm', '.wasm')
mimetypes.add_type('text/javascript', '.js')

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        self.byte_range = None
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        self.send_header('Cross-Origin-Resource-Policy', 'same-origin')
        self.send_header('Accept-Ranges', 'bytes')
        super().end_headers()

    def send_head(self):
        if not self.headers.get('Range'):
            return super().send_head()
        path = Path(self.translate_path(self.path))
        if not path.is_file():
            self.send_error(404)
            return None
        size = path.stat().st_size
        match = re.fullmatch(r'bytes=(\d*)-(\d*)', self.headers['Range'])
        if not match or not any(match.groups()):
            self.send_error(416)
            return None
        start = int(match[1]) if match[1] else max(0, size - int(match[2]))
        end = min(size - 1, int(match[2])) if match[1] and match[2] else size - 1
        if start >= size or end < start:
            self.send_response(416)
            self.send_header('Content-Range', 'bytes */%d' % size)
            self.send_header('Content-Length', '0')
            self.end_headers()
            return None
        self.byte_range = (start, end)
        self.send_response(206)
        self.send_header('Content-Type', self.guess_type(str(path)))
        self.send_header('Content-Range', 'bytes %d-%d/%d' % (start, end, size))
        self.send_header('Content-Length', str(end - start + 1))
        self.end_headers()
        source = path.open('rb')
        source.seek(start)
        return source

    def copyfile(self, source, outputfile):
        if self.byte_range is None:
            return super().copyfile(source, outputfile)
        remaining = self.byte_range[1] - self.byte_range[0] + 1
        while remaining:
            chunk = source.read(min(1024 * 1024, remaining))
            if not chunk:
                break
            outputfile.write(chunk)
            remaining -= len(chunk)

    def do_POST(self):
        url = urlsplit(self.path)
        if url.path != '/data/batch':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', '0'))
        if length > 1024 * 1024:
            self.send_error(413)
            return
        try:
            runs = json.loads(self.rfile.read(length))
            if not isinstance(runs, list) or len(runs) > 1000:
                raise ValueError('invalid batch')
            selected = []
            data_root = (ROOT / 'data').resolve()
            for name, start, end in runs:
                file = (data_root / name).resolve()
                if not file.is_relative_to(data_root) or start < 0 or end < start:
                    raise ValueError('invalid file/range')
                selected.append((file, start, max(0, min(end + 1, file.stat().st_size) - start)))
            total = sum(n for _, _, n in selected)
            if total > 64 * 1024 * 1024:
                raise ValueError('batch exceeds 64 MiB')
            output = io.BytesIO()
            for file, start, n in selected:
                with file.open('rb') as source:
                    source.seek(start)
                    output.write(source.read(n))
            body = output.getvalue()
            compressed = parse_qs(url.query).get('gz') == ['1']
            if compressed:
                body = gzip.compress(body, compresslevel=1)
            self.send_response(200)
            self.send_header('Content-Type', 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('X-Run-Lengths', ','.join(str(n) for _, _, n in selected))
            if compressed:
                self.send_header('Content-Encoding', 'gzip')
            self.end_headers()
            self.wfile.write(body)
        except (ValueError, TypeError, OSError) as exc:
            self.send_error(400, str(exc))

class LocalBuildHandler(Handler):
    def zip_proxy_route(self):
        return re.fullmatch(r'/release-proxy/v[12]/playgta5-part-(\d{2})-of-14\.zip', urlsplit(self.path).path)

    def zip_source_url(self, base_url, part):
        source = urlsplit(base_url)
        if (source.scheme not in ('http', 'https') or source.hostname not in ('localhost', '127.0.0.1', '::1')
                or source.username or source.password or source.query or source.fragment):
            raise ValueError('ZIP base must be an HTTP or HTTPS localhost URL without credentials, query, or fragment')
        if any(unquote(segment) in ('.', '..') for segment in source.path.split('/')):
            raise ValueError('ZIP base path cannot contain dot segments')
        try:
            source.port
        except ValueError as exc:
            raise ValueError('ZIP base has an invalid port') from exc
        filename = 'playgta5-part-%02d-of-14.zip' % part
        path = source.path.rstrip('/') + '/' + filename
        return '%s://%s%s' % (source.scheme, source.netloc, path)

    def end_headers(self):
        if self.zip_proxy_route() and self.headers.get('Origin') == PAGES_ORIGIN:
            self.send_header('Access-Control-Allow-Origin', PAGES_ORIGIN)
            self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
            self.send_header('Access-Control-Allow-Private-Network', 'true')
            self.send_header('Vary', 'Origin')
        super().end_headers()

    def do_OPTIONS(self):
        if not self.zip_proxy_route():
            self.send_error(404)
            return
        if self.headers.get('Origin') != PAGES_ORIGIN:
            self.send_error(403, 'Origin is not allowed')
            return
        self.send_response(204)
        self.send_header('Content-Length', '0')
        self.end_headers()

    def do_GET(self):
        match = self.zip_proxy_route()
        if not match:
            return super().do_GET()
        if self.headers.get('Origin') != PAGES_ORIGIN:
            self.send_error(403, 'Origin is not allowed')
            return

        part = int(match[1])
        if not 1 <= part <= 14:
            self.send_error(404)
            return

        bases = parse_qs(urlsplit(self.path).query).get('sourceBase', [])
        if len(bases) != 1:
            self.send_error(400, 'Provide exactly one localhost ZIP base URL')
            return
        try:
            source_url = self.zip_source_url(bases[0], part)
            with ZIP_OPENER.open(Request(source_url, headers={'Accept-Encoding': 'identity'}), timeout=30) as source:
                self.send_response(source.status)
                self.send_header('Content-Type', source.headers.get('Content-Type', 'application/octet-stream'))
                if source.headers.get('Content-Length'):
                    self.send_header('Content-Length', source.headers['Content-Length'])
                self.send_header('Cache-Control', 'no-store')
                self.end_headers()
                while chunk := source.read(1024 * 1024):
                    self.wfile.write(chunk)
        except HTTPError as exc:
            self.send_error(exc.code, 'Local ZIP source returned HTTP %d' % exc.code)
        except URLError as exc:
            self.send_error(502, 'Local ZIP source unavailable: %s' % exc.reason)
        except ValueError as exc:
            self.send_error(400, str(exc))

    def translate_path(self, path):
        route = urlsplit(path).path
        if route in ('/', '/index.html'):
            return str(PROJECT / 'index.html')
        build_files = {
            '/b/8b0b5899ed/loader.js': 'loader.js',
            '/b/8b0b5899ed/io_worker.js': 'io_worker.js',
            '/b/8b0b5899ed/wgpu_worker.js': 'wgpu_worker.js',
            '/b/8b0b5899ed/game.js': 'game.js',
            '/data/manifest.json': 'data-manifest.json',
        }
        if route in build_files:
            return str(PROJECT / build_files[route])
        return super().translate_path(path)

if __name__ == '__main__':
    args = argparse.ArgumentParser()
    args.add_argument('--port', type=int, default=8000)
    args.add_argument('--open', action='store_true', help='open the default browser after binding')
    options = args.parse_args()
    server = ThreadingHTTPServer(('127.0.0.1', options.port), LocalBuildHandler)
    address = 'http://localhost:%d/' % server.server_port
    print('Local mirror: %s (Ctrl+C to stop)' % address, flush=True)
    if options.open:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
