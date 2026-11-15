// Writes RC4-128 (V2 R3) encrypted PDFs for the bughunt tests. Standard security handler, hand-rolled.
// usage: node gen_encrypted.mjs <outdir>
import { createHash } from 'node:crypto'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const PAD = Buffer.from('28BF4E5E4E758A4164004E56FFFA01082E2E00B6D0683E802F0CA9FE6453697A', 'hex')
const md5 = (...parts) => { const h = createHash('md5'); for (const p of parts) h.update(p); return h.digest() }
function rc4(key, data) {
  const s = [...Array(256).keys()]
  let j = 0
  for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]] }
  const out = Buffer.alloc(data.length)
  let i = 0; j = 0
  for (let k = 0; k < data.length; k++) {
    i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]
    out[k] = data[k] ^ s[(s[i] + s[j]) & 255]
  }
  return out
}
const pad = (pw) => Buffer.concat([Buffer.from(pw, 'latin1'), PAD]).subarray(0, 32)

function makeKeys(userPw, ownerPw, P, id0) {
  // Algorithm 3 (O)
  let h = md5(pad(ownerPw || userPw))
  for (let i = 0; i < 50; i++) h = md5(h)
  const okey = h.subarray(0, 16)
  let O = rc4(okey, pad(userPw))
  for (let i = 1; i <= 19; i++) O = rc4(Buffer.from(okey.map((b) => b ^ i)), O)
  // Algorithm 2 (file key)
  const p = Buffer.alloc(4); p.writeInt32LE(P)
  let k = md5(pad(userPw), O, p, id0)
  for (let i = 0; i < 50; i++) k = md5(k.subarray(0, 16))
  const key = k.subarray(0, 16)
  // Algorithm 5 (U)
  let U = rc4(key, md5(PAD, id0))
  for (let i = 1; i <= 19; i++) U = rc4(Buffer.from(key.map((b) => b ^ i)), U)
  U = Buffer.concat([U, Buffer.alloc(16)])
  return { key, O, U }
}
const objKey = (key, num) => md5(key, Buffer.from([num & 255, (num >> 8) & 255, (num >> 16) & 255, 0, 0])).subarray(0, 16)
const hex = (b) => '<' + b.toString('hex') + '>'

function build(file, userPw, ownerPw, P) {
  const id0 = md5(Buffer.from(file))
  const { key, O, U } = makeKeys(userPw, ownerPw, P, id0)
  const enc = (num, data) => rc4(objKey(key, num), Buffer.from(data, 'latin1'))
  const content = (num, text) => {
    const body = enc(num, `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`)
    return Buffer.concat([Buffer.from(`<< /Length ${body.length} >>\nstream\n`), body, Buffer.from('\nendstream')])
  }
  const objects = [
    Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
    Buffer.from('<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>'),
    content(4, 'Secret page one with enough words to count as text'),
    Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>'),
    content(6, 'Secret page two with enough words to count as text'),
    Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'),
    Buffer.from(`<< /Title ${hex(enc(8, 'Confidential'))} >>`),
    Buffer.from(`<< /Filter /Standard /V 2 /R 3 /Length 128 /P ${P} /O ${hex(O)} /U ${hex(U)} >>`),
  ]
  const chunks = [Buffer.from('%PDF-1.6\n%\xe2\xe3\xcf\xd3\n', 'latin1')]
  const offsets = []
  let pos = chunks[0].length
  objects.forEach((body, i) => {
    offsets.push(pos)
    const c = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from('\nendobj\n')])
    chunks.push(c); pos += c.length
  })
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const o of offsets) xref += `${String(o).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 8 0 R /Encrypt 9 0 R /ID [${hex(id0)} ${hex(id0)}] >>\nstartxref\n${pos}\n%%EOF\n`
  chunks.push(Buffer.from(xref))
  return Buffer.concat(chunks)
}

const out = process.argv[2]
mkdirSync(out, { recursive: true })
// permissions-only: empty user password, owner password set, printing/modifying/copying denied (bits 3,4,5 off)
const ownerOnlyP = -3904 // 0xFFFFF0C0
writeFileSync(join(out, 'owner-only.pdf'), build('owner-only', '', 'ownerpw', ownerOnlyP))
// open password "secret"
writeFileSync(join(out, 'user-pw.pdf'), build('user-pw', 'secret', 'ownerpw', -4))
console.log('wrote', out)
