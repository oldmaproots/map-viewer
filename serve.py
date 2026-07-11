import http.server
import os

# どこから起動されてもこのファイルのあるフォルダを配信するようにする
os.chdir(os.path.dirname(os.path.abspath(__file__)))

# ブラウザがファイルをキャッシュ（一時保存）してしまい、
# 更新したのに古い内容が表示され続ける問題を防ぐためのサーバー。
class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

if __name__ == "__main__":
    http.server.test(HandlerClass=NoCacheHandler, port=5504)
