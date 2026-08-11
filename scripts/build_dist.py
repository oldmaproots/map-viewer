"""庁内へ配るZIPを1つ作る。

なぜZIPにするか
---------------
背景タイルだけで34,687ファイルある。フォルダのままネットワーク越しにコピーすると、
1ファイルごとに待ち時間が発生して何時間もかかる。ZIPなら1ファイルなので数分で済む。
共有サーバー側で展開してもらう。

何を入れるか
------------
  ・04MapViewer のプログラムとデータ（ただし庁内で使わないものは除く）
  ・data/kumamoto/*.geojson.js   … file:// では fetch が使えないため
  ・data/fgd_tiles/              … 10FGDBaseMap から合流させる（254MB）

出来るもの
----------
  _配布/地図ビューア_庁内版_YYYY-MM-DD.zip

システムPythonで動く。
"""
import datetime
import pathlib
import time
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent          # 04MapViewer
TILES = pathlib.Path(r"C:\Users\kyama\Documents\ClaudeCode\10FGDBaseMap\_publish\fgd_tiles")
OUT = ROOT / "_配布"

# 庁内では使わないので入れないもの
除く_フォルダ = {".git", ".claude", "_source", "downloaddata", "_reference", "_配布", "scripts"}
除く_ファイル = {".gitignore", "fgd-basemap-style.json",
                 "moj-style-2026-fill.json", "moj-style-2026-line.json"}


def main():
    if not TILES.exists():
        print(f"★ 背景タイルが見つかりません: {TILES}")
        print("   scripts/build_fgd_tiles.py で焼いてください")
        return

    js = list((ROOT / "data" / "kumamoto").glob("*.geojson.js"))
    if not js:
        print("★ 庁内版のデータ(.js)がありません。build_offline_data.py を先に流してください")
        return

    OUT.mkdir(exist_ok=True)
    name = f"地図ビューア_庁内版_{datetime.date.today():%Y-%m-%d}.zip"
    p = OUT / name
    t0 = time.time()
    n = 0

    # 圧縮しすぎると遅い。PNGは元から圧縮済みなので、控えめの設定で十分
    with zipfile.ZipFile(p, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
        for f in ROOT.rglob("*"):
            if not f.is_file():
                continue
            rel = f.relative_to(ROOT)
            if rel.parts[0] in 除く_フォルダ or rel.name in 除く_ファイル:
                continue
            # 庁内では fetch が使えないので .geojson そのものは要らない。
            # ただし将来 庁内Webサーバーに置くときのために残しておく
            z.write(f, "地図ビューア/" + rel.as_posix())
            n += 1
        for f in TILES.rglob("*.png"):
            z.write(f, "地図ビューア/data/fgd_tiles/" + f.relative_to(TILES).as_posix())
            n += 1
        idx = TILES / "index.js"
        if idx.exists():
            z.write(idx, "地図ビューア/data/fgd_tiles/index.js")
            n += 1

    mb = p.stat().st_size / 1024 / 1024
    print(f"できました: {p}")
    print(f"  {n:,} ファイル / {mb:,.0f} MB / {time.time() - t0:.0f}秒")
    print()
    print("配り方")
    print("  1. このZIPを共有サーバーへコピーする（1ファイルなので速い）")
    print("  2. サーバー側で展開する")
    print("  3. 利用者は 地図ビューア/index.html をダブルクリックで開く")


if __name__ == "__main__":
    main()
