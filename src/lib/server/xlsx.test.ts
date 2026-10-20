import { inflateRawSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { crc32, xlsx, zip } from './xlsx';

/** The files in a zip, read from its central directory (what spreadsheet apps do). */
function unzip(buf: Buffer): Map<string, string> {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, string>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const at = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString();
    expect(buf.readUInt32LE(at)).toBe(0x04034b50);
    const start = at + 30 + buf.readUInt16LE(at + 26);
    const raw = buf.subarray(start, start + size);
    const data = method === 8 ? inflateRawSync(raw) : raw;
    expect(crc32(data)).toBe(crc);
    out.set(name, data.toString());
    p += 46 + nameLen;
  }
  return out;
}

describe('crc32', () => {
  test('matches the standard check value', () => {
    expect(crc32(Buffer.from('123456789'))).toBe(0xcbf43926);
  });
});

describe('zip', () => {
  test('stores every file, readable back through the central directory', () => {
    const files = unzip(
      zip([
        ['a.txt', 'hello'],
        ['dir/ü.xml', '<x/>'],
      ]),
    );
    expect([...files]).toEqual([
      ['a.txt', 'hello'],
      ['dir/ü.xml', '<x/>'],
    ]);
  });
});

describe('xlsx', () => {
  const book = (rows: (string | number | null)[][]) => unzip(Buffer.from(xlsx('Sheet <1>', rows, [10, 20])));

  test('has the parts a spreadsheet app needs', () => {
    expect([...book([['a']]).keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
  });

  test('long ids are text cells, exactly as given; numbers stay numbers; empty cells are left out', () => {
    const sheet = book([
      ['id', 'tier'],
      ['76561198000000001', 2],
      ['', null],
    ]).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">76561198000000001</t></is></c>');
    expect(sheet).toContain('<c r="B2"><v>2</v></c>');
    expect(sheet).toContain('<row r="3"></row>');
    // the header row is bold
    expect(sheet).toContain('<c r="A1" s="1" t="inlineStr">');
    expect(sheet).toContain('<col min="2" max="2" width="20" customWidth="1"/>');
  });

  test('member-chosen text is escaped, and characters XML cannot hold are dropped', () => {
    const files = book([['<b>&"x"\u0007=SUM(A1)']]);
    expect(files.get('xl/worksheets/sheet1.xml')).toContain(
      '<t xml:space="preserve">&lt;b&gt;&amp;&quot;x&quot;=SUM(A1)</t>',
    );
    expect(files.get('xl/workbook.xml')).toContain('name="Sheet &lt;1&gt;"');
  });

  test('columns past Z get two letters', () => {
    const sheet = book([Array.from({ length: 28 }, (_, i) => i)]).get('xl/worksheets/sheet1.xml')!;
    expect(sheet).toContain(
      '<c r="Z1" s="1"><v>25</v></c><c r="AA1" s="1"><v>26</v></c><c r="AB1" s="1"><v>27</v></c>',
    );
  });
});
