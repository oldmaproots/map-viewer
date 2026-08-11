# -*- coding: utf-8 -*-
"""
data/kumamoto/*.geojson を、そのまま <script> で読める *.geojson.js に変換する。

■ なぜ必要か
このサイトは共有サーバーに置いたフォルダを index.html のダブルクリックで開く
(file:// で開く)使い方を想定している。file:// では fetch() がブラウザに拒まれるため、
GeoJSONをそのまま読むことができない。
そこで、GeoJSONを JavaScript のファイルに包み直し、<script> で読み込めるようにする。

■ 出力の形
    window.KUMAMOTO_DATA = window.KUMAMOTO_DATA || {};
    window.KUMAMOTO_DATA["youto_chiiki.geojson"] = { ... };

キーは元のファイル名そのもの。読み込む側(kumamoto.js / youto-circles.js)は
ファイル名でデータを引けるので、書き換えが最小で済む。

■ 元の .geojson は消さない
将来 庁内のWebサーバーに置く場合は fetch() が使えるので、元のファイルが要る。

使い方（どちらのPythonでも動く。外部ライブラリを使わない）:
  python scripts/build_offline_data.py
"""

import json
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data" / "kumamoto"


def main():
    files = sorted(DATA_DIR.glob("*.geojson"))
    if not files:
        print(f"[エラー] {DATA_DIR} に .geojson がありません")
        return

    total_in = 0
    total_out = 0
    for path in files:
        # Windowsの既定はcp932なので、読み書きとも utf-8 を明示する
        with open(path, encoding="utf-8") as f:
            text = f.read()
        # 中身が壊れていないことだけ確かめる(整形はしない。そのまま埋め込むほうが小さい)
        json.loads(text)

        out = path.with_suffix(path.suffix + ".js")  # xxx.geojson -> xxx.geojson.js
        with open(out, "w", encoding="utf-8", newline="\n") as f:
            f.write("window.KUMAMOTO_DATA = window.KUMAMOTO_DATA || {};\n")
            f.write(f"window.KUMAMOTO_DATA[{json.dumps(path.name)}] =\n")
            f.write(text.rstrip())
            f.write(";\n")

        total_in += path.stat().st_size
        total_out += out.stat().st_size
        print(f"  {path.name:<40} {out.stat().st_size/1024/1024:6.2f}MB")

    print(f"\n■ {len(files)}ファイルを変換しました")
    print(f"  もと {total_in/1024/1024:,.1f}MB → .js {total_out/1024/1024:,.1f}MB")
    print("  （元の .geojson はそのまま残しています）")


if __name__ == "__main__":
    main()
