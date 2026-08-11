# -*- coding: utf-8 -*-
"""
基盤地図情報(熊本県)のGeoPackageから、背景地図に使う「線」の項目だけを取り出し、
Webメルカトル(EPSG:3857)に投影し直した作業用ファイルを作る。

なぜ作るのか:
  もとの gpkg は 1.5GB・367万地物で、緯度経度(JGD2011)のまま入っている。
  タイルを焼くときは 6万7千枚ぶんの描画で何度も読むので、
  そのたびに投影変換をすると時間がかかる。
  先に3857へ直し、属性を捨てて空間索引を付けた作業用ファイルを作っておくと速い。

出力先はテンポラリ(作業用)。配布物には入らない。
タイルを焼き直すときだけ必要で、消してもよい。

使い方（QGIS付属のPythonで動かす。GDALのPythonが必要なため）:
  "C:\\Program Files\\QGIS 3.44.9\\bin\\python-qgis-ltr.bat" scripts/build_fgd_slim.py
"""

import pathlib
import sys
import time

from osgeo import gdal, ogr

gdal.UseExceptions()

SRC_GPKG = pathlib.Path(
    r"C:\Users\kyama\Documents\ClaudeCode\10FGDBaseMap\data\基盤地図情報_熊本県.gpkg"
)
OUT_GPKG = pathlib.Path(__file__).resolve().parent / "_work" / "fgd_lines_3857.gpkg"

# 背景地図に描く線の項目（fgd-basemap-style.json に出てくるものと同じ）
LINE_LAYERS = [
    "海岸線",
    "行政界線",
    "軌道の中心線",
    "水涯線",
    "道路縁",
    "水部構造物線",
    "道路構成線",
    "町字界線",
    "建築物外周線",
]


def main():
    OUT_GPKG.parent.mkdir(parents=True, exist_ok=True)
    if OUT_GPKG.exists():
        print(f"作成済みなので使い回します: {OUT_GPKG.stat().st_size/1024/1024:,.0f}MB")
        return
    tmp = OUT_GPKG.with_suffix(".tmp.gpkg")
    if tmp.exists():
        tmp.unlink()

    t0 = time.time()
    for i, name in enumerate(LINE_LAYERS):
        # ogr.Open(...).GetLayerByName(...) と1行で書くと
        # レイヤーを使う前にファイルが閉じられて落ちるので、必ず変数に受ける
        src = ogr.Open(str(SRC_GPKG))
        if src is None:
            print(f"[エラー] {SRC_GPKG} を開けません")
            sys.exit(1)
        if src.GetLayerByName(name) is None:
            print(f"  [警告] {name} が元ファイルにありません")
            src = None
            continue
        src = None

        t1 = time.time()
        gdal.VectorTranslate(
            str(tmp), str(SRC_GPKG),
            options=gdal.VectorTranslateOptions(
                format="GPKG",
                # 属性は使わない（灰色一色で描くので）。図形だけにすると大幅に小さくなる
                SQLStatement=f'SELECT geom FROM "{name}"',
                layerName=name,
                accessMode=None if i == 0 else "append",
                dstSRS="EPSG:3857",
                reproject=True,
            ),
        )
        out = ogr.Open(str(tmp))
        n = out.GetLayerByName(name).GetFeatureCount()
        out = None
        print(f"  {name:<10}{n:>10,}件  {time.time()-t1:.0f}秒", flush=True)

    tmp.rename(OUT_GPKG)
    print(f"\n■ できあがり: {OUT_GPKG}")
    print(f"  {OUT_GPKG.stat().st_size/1024/1024:,.0f}MB / {time.time()-t0:.0f}秒")


if __name__ == "__main__":
    main()
