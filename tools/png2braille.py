"""把 assets/logo-white-512.png 转成盲文点阵（2x4 点/字符），输出供 bin/orcode.js 内嵌。
用法: python tools/png2braille.py <宽度列数> [阈值] [子采样数] > out.txt
阈值：每个点位置需达到的覆盖子采样数（3x3 子采样下 4=约44%、3=约33%）
"""
import struct, zlib, sys

def load_rgba(path):
    f = open(path, 'rb').read()
    pos, idat = 8, b''
    w = h = None
    while pos < len(f):
        ln = struct.unpack('>I', f[pos:pos+4])[0]
        typ = f[pos+4:pos+8]
        d = f[pos+8:pos+8+ln]
        if typ == b'IHDR':
            w, h = struct.unpack('>II', d[:8])
        elif typ == b'IDAT':
            idat += d
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    stride = w * 4
    px = bytearray(w * h * 4)
    p = 0
    for y in range(h):
        p += 1  # filter type 0
        px[y*stride:(y+1)*stride] = raw[p:p+stride]
        p += stride
    return w, h, px

def bbox(w, h, px, thr=60):
    minx, maxx, miny, maxy = w, 0, h, 0
    for y in range(0, h, 2):
        for x in range(0, w, 2):
            if px[(y*w+x)*4+3] > thr:
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
    return minx, maxx, miny, maxy

BITS = [0,1,2,6, 3,4,5,7]  # 左列 dot1-4，右列 dot5-8

def render(px, w, h, box, bw, thr=4, sub=3):
    x0, x1, y0, y1 = box
    sw = (x1 - x0 + 1) / (bw * 2)
    sh = sw
    bh = max(1, int((y1 - y0 + 1) / sh / 4))
    out = []
    for br in range(bh):
        line = ''
        for bc in range(bw):
            mask = 0
            for dr in range(4):
                for dc in range(2):
                    bx = int(x0 + (bc*2 + dc) * sw)
                    by = int(y0 + (br*4 + dr) * sh)
                    cov = 0
                    for sdy in range(sub):
                        for sdx in range(sub):
                            sx = bx + int(sdx * sw / sub)
                            sy = by + int(sdy * sh / sub)
                            if 0 <= sx < w and 0 <= sy < h and px[(sy*w+sx)*4+3] > 60:
                                cov += 1
                    if cov >= thr:
                        mask |= (1 << BITS[dr]) if dc == 0 else (1 << BITS[4+dr])
            line += chr(0x2800 + mask) if mask else ' '
        out.append(line.rstrip())
    return out

if __name__ == '__main__':
    src = 'assets/logo-white-512.png'
    bw = int(sys.argv[1]) if len(sys.argv) > 1 else 64
    thr = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    sub = int(sys.argv[3]) if len(sys.argv) > 3 else 3
    w, h, px = load_rgba(src)
    box = bbox(w, h, px)
    lines = render(px, w, h, box, bw, thr, sub)
    for l in lines:
        print(l)
    sys.stderr.write('[braille] %d cols x %d rows (thr=%d)\n' % (bw, len(lines), thr))
