# -*- coding: utf-8 -*-
"""
基盤地図情報(熊本県)の線データから、背景地図のPNGタイルを焼く。

■ なぜラスタ(PNG)にするのか
これまでの背景地図はベクトルタイル(PMTiles)をMapLibreで描いていた。
MapLibreはWebWorkerを、PMTilesはHTTPのRange要求を使うため、
どちらも file:// では動かない。庁内では index.html をダブルクリックで開くので、
ふつうの画像タイルに焼き直しておく必要がある。

■ 焼く範囲
  熊本県全域            z8〜z14
  都市計画区域(17区域)の中  z15〜z17
z15以上を県全域で焼くと35万枚を超え、共有サーバーへのコピーだけで何時間もかかる。
都市計画図を重ねて見るのが目的なので、細かい縮尺は都市計画区域の中だけでよい。

■ 描き方
fgd-basemap-style.json（これまでのベクトルタイル用の設定）と同じ
「灰色1色・縮尺ごとに出す項目を変える・線の太さも縮尺で変える」を再現する。
背景は白。下に何も敷かないため透明にはしない。
中身が真っ白なタイル（海の上など）は書き出さない。

■ 速さの工夫
1枚ずつ描くと6万7千回の描画準備が要る。
8×8=64枚ぶんをまとめて1枚(2048px)に描き、あとで切り分ける（メタタイル）。
縮尺は同じなので、1枚ずつ描いたものと見た目は変わらない。
切り分けるときに線が端で切れないよう、周囲8pxを余分に描いてから切り出す。

使い方（QGIS付属のPythonで動かす）:
  "C:\\Program Files\\QGIS 3.44.9\\bin\\python-qgis-ltr.bat" scripts/build_fgd_tiles.py
  # 途中まででやめるとき（例: z16まで）:
  "...\\python-qgis-ltr.bat" scripts/build_fgd_tiles.py --max-zoom 16

QGISのスクリプトは終了コード5を返すことがあるが異常ではない。
標準出力が消えることがあるので、進み具合は scripts/_work/tiles_progress.log にも書く。
"""

import argparse
import json
import math
import os
import pathlib
import sys
import time

import numpy as np
from osgeo import gdal, ogr, osr

gdal.UseExceptions()

ROOT = pathlib.Path(__file__).resolve().parent.parent
WORK = ROOT / "scripts" / "_work"
SLIM_GPKG = WORK / "fgd_lines_3857.gpkg"
AREA_GEOJSON = ROOT / "data" / "kumamoto" / "toshikeikaku_kuiki_area.geojson"
# 焼いたタイルは 10FGDBaseMap に置く。34,687ファイル・254MBあり、
# 04MapViewer に置くとGitの動きが重くなるうえ、誤って公開する危険もあるため。
# 配布ZIPを作るとき（scripts/build_dist.py）にここから合流させる。
OUT_DIR = pathlib.Path(r"C:\Users\kyama\Documents\ClaudeCode\10FGDBaseMap\_publish\fgd_tiles")
PROGRESS_LOG = WORK / "tiles_progress.log"

TILE_PX = 256
METATILE = 8          # メタタイル1枚に入れるタイルの数(縦横とも)
MARGIN_PX = 8         # 切り分けたときに線が端で切れないよう余分に描く幅

# Webメルカトルの世界の広さ(m)。タイルの座標計算に使う
WORLD = 20037508.342789244

# 県全域を焼く縮尺と、都市計画区域の中だけ焼く縮尺
WIDE_ZOOMS = range(8, 15)     # z8〜z14
DETAIL_ZOOMS = range(15, 18)  # z15〜z17

# ------------------------------------------------------------
# 線の描き方（fgd-basemap-style.json と同じ）
#   minzoom … この縮尺から描き始める
#   color   … 線の色（灰色の濃さだけが違う）
#   width   … [縮尺, 太さ(px)] の組。間は直線で補間し、外側は端の値で止める
#   opacity … 同じ形式。省略すると1
#   dash    … 破線にするときの [線, すき間] (px)
# 道路縁だけは、これまでのベクトルタイルの作り方(build_web_tiles.py)に合わせて
# z11から出す（スタイル側は12だが、タイルはz11から入っていた）。
# ------------------------------------------------------------
STYLE = [
    # 描く順は下から上へ。あとに書いたものほど手前に描かれる
    ("建築物外周線", dict(minzoom=14, color="#9a9a9a",
                     width=[(14, 0.4), (18, 1.0)], opacity=[(14, 0.5), (16, 0.9)])),
    ("水涯線",     dict(minzoom=11, color="#8a8a8a", width=[(11, 0.4), (18, 1.2)])),
    ("水部構造物線", dict(minzoom=12, color="#8a8a8a", width=[(12, 0.4), (18, 1.0)])),
    ("道路縁",     dict(minzoom=11, color="#8a8a8a",
                     width=[(12, 0.3), (15, 0.7), (18, 1.4)])),
    ("道路構成線",  dict(minzoom=13, color="#9a9a9a", width=[(13, 0.3), (18, 0.9)])),
    ("軌道の中心線", dict(minzoom=10, color="#7a7a7a", width=[(10, 0.5), (18, 1.6)])),
    ("町字界線",    dict(minzoom=13, color="#a8a8a8", width=[(13, 0.6)], dash=[4, 3])),
    ("行政界線",    dict(minzoom=8, color="#6f6f6f", width=[(8, 0.6), (14, 1.4)])),
    ("海岸線",     dict(minzoom=8, color="#6f6f6f", width=[(8, 0.6), (14, 1.4)])),
]


def interp(stops, z):
    """[(縮尺, 値), ...] を縮尺zで補間する。範囲の外は端の値で止める"""
    if z <= stops[0][0]:
        return stops[0][1]
    if z >= stops[-1][0]:
        return stops[-1][1]
    for (z0, v0), (z1, v1) in zip(stops, stops[1:]):
        if z0 <= z <= z1:
            return v0 + (v1 - v0) * (z - z0) / (z1 - z0)
    return stops[-1][1]


def log(msg):
    print(msg, flush=True)
    with open(PROGRESS_LOG, "a", encoding="utf-8") as f:
        f.write(f"{time.strftime('%H:%M:%S')} {msg}\n")


# ============================================================
# どのタイルを焼くかを決める
# ============================================================
def tile_bounds_3857(z, x, y):
    """タイル(z,x,y)の範囲を Webメルカトルの座標(m)で返す"""
    size = 2 * WORLD / (2 ** z)
    minx = -WORLD + x * size
    maxy = WORLD - y * size
    return minx, maxy - size, minx + size, maxy


def lonlat_to_tile(lon, lat, z):
    n = 2 ** z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return max(0, min(n - 1, x)), max(0, min(n - 1, y))


def area_tiles(z, area_ds_path):
    """都市計画区域(17区域)に少しでもかかるタイルの一覧を返す。

    タイル1枚を画素1つに見立てた白黒の画像を作り、そこへ区域を塗る。
    塗られた画素＝焼くべきタイル。ALL_TOUCHED で、かすっただけの画素も塗る。
    """
    src = ogr.Open(area_ds_path)
    layer = src.GetLayer(0)  # 1行で書くと落ちるので必ず変数に受ける
    xmin, xmax, ymin, ymax = layer.GetExtent()
    src = None

    size = 2 * WORLD / (2 ** z)
    tx0 = int((xmin + WORLD) // size)
    tx1 = int((xmax + WORLD) // size)
    ty0 = int((WORLD - ymax) // size)
    ty1 = int((WORLD - ymin) // size)
    w = tx1 - tx0 + 1
    h = ty1 - ty0 + 1

    drv = gdal.GetDriverByName("MEM")
    ds = drv.Create("", w, h, 1, gdal.GDT_Byte)
    ds.SetGeoTransform((-WORLD + tx0 * size, size, 0, WORLD - ty0 * size, 0, -size))
    srs = osr.SpatialReference()
    srs.ImportFromEPSG(3857)
    ds.SetProjection(srs.ExportToWkt())
    gdal.Rasterize(ds, area_ds_path, options=gdal.RasterizeOptions(
        burnValues=[1], allTouched=True))
    arr = ds.ReadAsArray()
    ds = None

    ys, xs = np.nonzero(arr)
    return {(int(tx0 + px), int(ty0 + py)) for py, px in zip(ys, xs)}


def wide_tiles(z, extent_lonlat):
    """県全域(データのある範囲)のタイルを返す。海の上などは描いたあと白判定で捨てる"""
    lon0, lat0, lon1, lat1 = extent_lonlat
    x0, y1 = lonlat_to_tile(lon0, lat0, z)  # 南西 → x最小 / y最大
    x1, y0 = lonlat_to_tile(lon1, lat1, z)  # 北東 → x最大 / y最小
    return {(x, y) for x in range(x0, x1 + 1) for y in range(y0, y1 + 1)}


# ============================================================
# QGISで描く
# ============================================================
def build(min_zoom, max_zoom, write_idx=True):
    from qgis.core import (QgsApplication, QgsVectorLayer, QgsMapSettings,
                           QgsMapRendererParallelJob, QgsRectangle,
                           QgsCoordinateReferenceSystem, QgsLineSymbol,
                           QgsSingleSymbolRenderer, QgsUnitTypes)
    from qgis.PyQt.QtCore import QSize, Qt
    from qgis.PyQt.QtGui import QColor, QImage, qRgb

    # 出来上がりを灰色16段の「パレット画像」にする。
    # 描くのは白地に灰色の線だけなので、色を16段に絞ってもまず見分けがつかない。
    # PNGが半分近くまで小さくなり、共有サーバーへのコピーが速くなる。
    # いちばん濃い線が #6f6f6f なので、そこから白までを16等分している。
    gray_values = [int(0x6A + (0xFF - 0x6A) * i / 15) for i in range(16)]
    color_table = [qRgb(v, v, v) for v in gray_values]
    WHITE_INDEX = 15  # 何も描かれていない画素（＝白）のパレット番号

    prefix = os.environ.get("QGIS_PREFIX_PATH", r"C:\Program Files\QGIS 3.44.9\apps\qgis-ltr")
    QgsApplication.setPrefixPath(prefix, True)
    qgs = QgsApplication([], False)
    qgs.initQgis()

    # --- 元データ(3857に直した線だけのファイル)を読む ---
    layers = {}
    for name, _ in STYLE:
        vl = QgsVectorLayer(f"{SLIM_GPKG}|layername={name}", name, "ogr")
        if not vl.isValid():
            log(f"[警告] {name} を読めません。とばします")
            continue
        layers[name] = vl

    # --- 都市計画区域を3857に直しておく（タイルの選び方に使う） ---
    area_3857 = WORK / "toshikeikaku_area_3857.gpkg"
    if not area_3857.exists():
        gdal.VectorTranslate(str(area_3857), str(AREA_GEOJSON),
                             options=gdal.VectorTranslateOptions(
                                 format="GPKG", dstSRS="EPSG:3857", reproject=True))

    # --- データのある範囲(緯度経度) ---
    src = ogr.Open(str(ROOT / "scripts" / "_work" / "fgd_lines_3857.gpkg"))
    lyr = src.GetLayerByName("海岸線")
    ext = lyr.GetExtent()  # 3857 の (xmin, xmax, ymin, ymax)
    src = None
    # 県全体をおおうように、建築物の範囲もあわせて広めにとる
    lon0, lat0 = -180 + (ext[0] + WORLD) / (2 * WORLD) * 360, 0
    del lon0, lat0
    extent_lonlat = (129.90, 32.03, 131.42, 33.30)  # 熊本県をおおう範囲

    # --- 焼くタイルの一覧 ---
    plan = {}
    for z in WIDE_ZOOMS:
        if not (min_zoom <= z <= max_zoom):
            continue
        plan[z] = wide_tiles(z, extent_lonlat)
    for z in DETAIL_ZOOMS:
        if not (min_zoom <= z <= max_zoom):
            continue
        plan[z] = area_tiles(z, str(area_3857))
    total_planned = sum(len(v) for v in plan.values())
    log(f"焼く予定のタイル: {total_planned:,}枚  " +
        " ".join(f"z{z}={len(v):,}" for z, v in sorted(plan.items())))

    crs3857 = QgsCoordinateReferenceSystem("EPSG:3857")
    written = {}
    index = {}
    t_start = time.time()

    for z in sorted(plan):
        # --- この縮尺で描く項目と、その太さ・色を決める ---
        active = []
        for name, st in STYLE:
            if z < st["minzoom"] or name not in layers:
                continue
            sym = QgsLineSymbol.createSimple({})
            sl = sym.symbolLayer(0)
            sl.setColor(QColor(st["color"]))
            sl.setWidth(interp(st["width"], z))
            sl.setWidthUnit(QgsUnitTypes.RenderPixels)
            sl.setPenCapStyle(Qt.RoundCap)
            sl.setPenJoinStyle(Qt.RoundJoin)
            if st.get("dash"):
                sl.setUseCustomDashPattern(True)
                sl.setCustomDashVector(st["dash"])
                sl.setCustomDashPatternUnit(QgsUnitTypes.RenderPixels)
            if st.get("opacity"):
                sym.setOpacity(interp(st["opacity"], z))
            vl = layers[name]
            vl.setRenderer(QgsSingleSymbolRenderer(sym))
            active.append(vl)
        # QGISは一覧の先頭を手前に描く。STYLEは奥から並べてあるので逆にする
        active.reverse()

        tiles = plan[z]
        # 8×8のかたまり(メタタイル)にまとめる
        metas = {}
        for (x, y) in tiles:
            metas.setdefault((x // METATILE, y // METATILE), []).append((x, y))

        size = 2 * WORLD / (2 ** z)
        res = size / TILE_PX  # 1画素あたりのメートル
        img_px = METATILE * TILE_PX + 2 * MARGIN_PX
        nz = 0
        t0 = time.time()

        for i, (mkey, members) in enumerate(sorted(metas.items())):
            mx, my = mkey
            minx = -WORLD + mx * METATILE * size
            maxy = WORLD - my * METATILE * size
            maxx = minx + METATILE * size
            miny = maxy - METATILE * size
            m = MARGIN_PX * res

            ms = QgsMapSettings()
            ms.setDestinationCrs(crs3857)
            ms.setLayers(active)
            ms.setBackgroundColor(QColor(255, 255, 255))
            ms.setOutputSize(QSize(img_px, img_px))
            ms.setExtent(QgsRectangle(minx - m, miny - m, maxx + m, maxy + m))
            ms.setFlag(QgsMapSettings.Antialiasing, True)
            ms.setOutputDpi(96)

            job = QgsMapRendererParallelJob(ms)
            job.start()
            job.waitForFinished()
            # 灰色16段のパレット画像に直す。Qt.ThresholdDither は
            # 「いちばん近い色に置き換えるだけ（点々を混ぜない）」の指定
            big = job.renderedImage().convertToFormat(
                QImage.Format_Indexed8, color_table, Qt.ThresholdDither)

            for (x, y) in members:
                px = MARGIN_PX + (x - mx * METATILE) * TILE_PX
                py = MARGIN_PX + (y - my * METATILE) * TILE_PX
                sub = big.copy(px, py, TILE_PX, TILE_PX)
                buf = sub.constBits()
                buf.setsize(sub.sizeInBytes())
                arr = np.frombuffer(bytes(buf), dtype=np.uint8)
                if arr.min() >= WHITE_INDEX:
                    continue  # 中身が真っ白なタイルは書かない
                d = OUT_DIR / str(z) / str(x)
                d.mkdir(parents=True, exist_ok=True)
                sub.save(str(d / f"{y}.png"), "PNG")
                index.setdefault(z, {}).setdefault(x, []).append(y)
                nz += 1

            if (i + 1) % 100 == 0:
                log(f"  z{z}: メタタイル {i+1:,}/{len(metas):,}  "
                    f"書いた {nz:,}枚  {time.time()-t0:.0f}秒")

        written[z] = nz
        log(f"z{z} 完了: {nz:,}枚 / 予定{len(tiles):,}枚  {time.time()-t0:.0f}秒")

    # --- タイルの一覧を書き出す ---
    # 無いタイルをブラウザが取りに行くと file:// では読み込み失敗が並ぶので、
    # 「どのタイルがあるか」をサイト側に渡し、無いところは白い画像で済ませる
    if write_idx:
        write_index(index)

    log(f"■ 合計 {sum(written.values()):,}枚 / {time.time()-t_start:.0f}秒")
    for z in sorted(written):
        log(f"   z{z}: {written[z]:,}枚")
    # exitQgis() はQGISの後始末で落ちることがある。
    # ここまでで仕事は終わっているので、そのまま抜ける
    sys.stdout.flush()
    os._exit(0)


def write_index(index):
    """data/fgd_tiles/index.js を書く。形は {"z": {"x": "y1,y2,..."}}"""
    compact = {str(z): {str(x): ",".join(str(v) for v in sorted(ys))
                        for x, ys in xs.items()}
               for z, xs in index.items()}
    out = OUT_DIR / "index.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", encoding="utf-8", newline="\n") as f:
        f.write("// 焼いてあるタイルの一覧（build_fgd_tiles.py が自動生成）。\n")
        f.write("// 無いタイルを取りに行かせないために使う。\n")
        f.write("window.FGD_TILE_INDEX = ")
        json.dump(compact, f, separators=(",", ":"))
        f.write(";\n")
    log(f"タイル一覧: {out} ({out.stat().st_size/1024/1024:.1f}MB)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--min-zoom", type=int, default=8)
    ap.add_argument("--max-zoom", type=int, default=17,
                    help="ここまでの縮尺を焼く（途中で打ち切るときに使う）")
    ap.add_argument("--no-index", action="store_true",
                    help="タイル一覧(index.js)を書かない（一部だけ焼き直すとき）")
    args = ap.parse_args()

    WORK.mkdir(parents=True, exist_ok=True)
    if not SLIM_GPKG.exists():
        log(f"[エラー] {SLIM_GPKG} がありません。先に build_fgd_slim.py を実行してください")
        sys.exit(1)
    build(args.min_zoom, args.max_zoom, write_idx=not args.no_index)


if __name__ == "__main__":
    main()
