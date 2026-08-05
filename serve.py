import http.server
import os
import re

# どこから起動されてもこのファイルのあるフォルダを配信するようにする
os.chdir(os.path.dirname(os.path.abspath(__file__)))


# ブラウザがファイルをキャッシュ（一時保存）してしまい、
# 更新したのに古い内容が表示され続ける問題を防ぐためのサーバー。
#
# あわせて「範囲リクエスト（Range）」にも対応させている。
# ベクトルタイルのPMTiles（基盤地図情報の背景地図）は1つの大きなファイルで、
# ブラウザは「何バイト目から何バイト目まで」と指定して必要な部分だけを取ってくる。
# Python標準のサーバーはこれに対応していないため、ローカルで確認するときに
# 「Check that your storage backend supports HTTP Byte Serving」というエラーになる。
# 公開先のGitHub Pagesは対応しているので、ここはローカル確認のためだけの対応。
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        self.send_header("Accept-Ranges", "bytes")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng.strip())
        if not m:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(404, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        start_s, end_s = m.group(1), m.group(2)
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:
            # 「bytes=-500」＝末尾500バイト、という書き方
            start = max(0, size - int(end_s))
            end = size - 1
        end = min(end, size - 1)
        if start > end or start >= size:
            f.close()
            self.send_response(416)
            self.send_header("Content-Range", f"bytes */{size}")
            self.end_headers()
            return None

        self.send_response(206)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        f.seek(start)
        return _LimitedFile(f, end - start + 1)


class _LimitedFile:
    """指定した長さだけ読ませるための包み。copyfileがこれを読んで送る"""

    def __init__(self, f, remaining):
        self._f = f
        self._remaining = remaining

    def read(self, n=-1):
        if self._remaining <= 0:
            return b""
        if n is None or n < 0 or n > self._remaining:
            n = self._remaining
        data = self._f.read(n)
        self._remaining -= len(data)
        return data

    def close(self):
        self._f.close()


if __name__ == "__main__":
    http.server.test(HandlerClass=NoCacheHandler, port=5504)
