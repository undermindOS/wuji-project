/** Drops the alpha channel: canvas pixels are RGBA, a PDF image here is RGB. */
export function rgbFromRgba(rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  const rgb = new Uint8Array(rgba.length / 4 * 3);
  for (let from = 0, to = 0; from < rgba.length; from += 4) { rgb[to++] = rgba[from]; rgb[to++] = rgba[from + 1]; rgb[to++] = rgba[from + 2]; }
  return rgb;
}

/** zlib-compressed bytes, which is what a PDF FlateDecode stream holds. */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export interface ImagePdf {
  /** Compressed pixels: a zlib stream of RGB rows (FlateDecode) or a JPEG file (DCTDecode). */
  data: Uint8Array;
  filter: 'FlateDecode' | 'DCTDecode';
  /** Image size in pixels. */
  width: number;
  height: number;
  /** Page size in points; the image fills the page. */
  pageWidth: number;
  pageHeight: number;
  /** Document title shown by PDF viewers. Non-ASCII characters are replaced. */
  title: string;
}

/** A one-page PDF that is exactly one image. Nothing else is written into the file: no producer, no dates. */
export function imagePdf({ data, filter, width, height, pageWidth, pageHeight, title }: ImagePdf): Uint8Array {
  const encoder = new TextEncoder();
  const text = title.replace(/[–—]/g, '-').replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const size = `${pageWidth.toFixed(2)} ${pageHeight.toFixed(2)}`;
  const content = `q ${pageWidth.toFixed(2)} 0 0 ${pageHeight.toFixed(2)} 0 0 cm /Im0 Do Q`;
  const objects: (string | Uint8Array)[][] = [
    ['<< /Type /Catalog /Pages 2 0 R >>'],
    ['<< /Type /Pages /Kids [3 0 R] /Count 1 >>'],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`],
    [`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /${filter} /Length ${data.length} >>\nstream\n`, data, '\nendstream'],
    [`<< /Length ${content.length} >>\nstream\n${content}\nendstream`],
    [`<< /Title (${text}) >>`],
  ];
  const chunks: Uint8Array[] = [];
  let length = 0;
  const write = (part: string | Uint8Array) => { const bytes = typeof part === 'string' ? encoder.encode(part) : part; chunks.push(bytes); length += bytes.length; };
  write('%PDF-1.4\n');
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));
  const offsets = objects.map((parts, index) => {
    const offset = length;
    write(`${index + 1} 0 obj\n`);
    parts.forEach(write);
    write('\nendobj\n');
    return offset;
  });
  const xref = length;
  write(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`);
  write(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info ${objects.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const file = new Uint8Array(length);
  let position = 0;
  for (const chunk of chunks) { file.set(chunk, position); position += chunk.length; }
  return file;
}
