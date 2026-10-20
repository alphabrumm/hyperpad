/**
 * Minimaler ZIP-Packer (ohne Kompression, „stored“).
 * Reicht für Schülerprojekte völlig aus und braucht keine fremde Bibliothek.
 * Dateinamen werden als UTF-8 markiert, damit Umlaute auf Windows, macOS und iPadOS stimmen.
 */

export type ZipEntry = { path: string, data: Uint8Array };

const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        t[n] = c >>> 0;
    }
    return t;
})();

function crc32(data: Uint8Array): number {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
}

/** Datum und Uhrzeit im DOS-Format, wie ZIP es erwartet (Ortszeit). */
function dosDateTime(d: Date): { time: number, date: number } {
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
    const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    return { time, date };
}

export function createZip(entries: ZipEntry[], when: Date = new Date()): Blob {
    const enc = new TextEncoder();
    const { time, date } = dosDateTime(when);
    const parts: Uint8Array[] = [];
    const central: Uint8Array[] = [];
    let offset = 0;

    for (const e of entries) {
        const name = enc.encode(e.path);
        const isDir = e.path.endsWith("/");
        const crc = isDir ? 0 : crc32(e.data);
        const size = isDir ? 0 : e.data.length;

        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);          // benötigte Version
        local.setUint16(6, 0x0800, true);      // Bit 11: Dateinamen in UTF-8
        local.setUint16(8, 0, true);           // keine Kompression
        local.setUint16(10, time, true);
        local.setUint16(12, date, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, size, true);
        local.setUint32(22, size, true);
        local.setUint16(26, name.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), name);
        if (!isDir) parts.push(e.data);

        const cen = new DataView(new ArrayBuffer(46));
        cen.setUint32(0, 0x02014b50, true);
        cen.setUint16(4, 20, true);
        cen.setUint16(6, 20, true);
        cen.setUint16(8, 0x0800, true);
        cen.setUint16(10, 0, true);
        cen.setUint16(12, time, true);
        cen.setUint16(14, date, true);
        cen.setUint32(16, crc, true);
        cen.setUint32(20, size, true);
        cen.setUint32(24, size, true);
        cen.setUint16(28, name.length, true);
        cen.setUint16(30, 0, true);
        cen.setUint16(32, 0, true);
        cen.setUint16(34, 0, true);
        cen.setUint16(36, 0, true);
        cen.setUint32(38, isDir ? 0x10 : 0, true); // externe Attribute: Ordner
        cen.setUint32(42, offset, true);
        central.push(new Uint8Array(cen.buffer), name);

        offset += 30 + name.length + size;
    }

    const centralSize = central.reduce((s, p) => s + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, entries.length, true);
    end.setUint16(10, entries.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);

    return new Blob([...parts, ...central, new Uint8Array(end.buffer)] as BlobPart[], { type: "application/zip" });
}

/** Wandelt eine data:-URL (Bilder im Projekt) in Bytes um. */
export function dataUrlToBytes(url: string): Uint8Array {
    const comma = url.indexOf(",");
    const meta = url.substring(0, comma);
    const payload = url.substring(comma + 1);
    if (/;base64/i.test(meta)) {
        const bin = atob(payload);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }
    return new TextEncoder().encode(decodeURIComponent(payload));
}
