/* Motor — mídia: Supabase Storage, conversão de áudio e transcrição */

const { spawn } = require('child_process');
const crypto = require('crypto');

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const GROQ_KEY = process.env.GROQ_API_KEY || '';

let ffmpegPath = null;
try { ffmpegPath = require('ffmpeg-static'); } catch (e) {}

/* ---------- Supabase Storage ---------- */

function urlPublica(caminho) {
  return `${URL_BASE}/storage/v1/object/public/midias/${caminho}`;
}

/* sobe um buffer para o bucket `midias` e devolve a URL pública */
async function subirMidia(caminho, buffer, mime) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/midias/${caminho}`, {
    method: 'POST',
    headers: {
      apikey: KEY,
      Authorization: 'Bearer ' + KEY,
      'content-type': mime || 'application/octet-stream',
      'x-upsert': 'true'
    },
    body: buffer
  });
  if (!r.ok) throw new Error(`Storage ${r.status}: ${(await r.text()).slice(0, 180)}`);
  return urlPublica(caminho);
}

async function baixarUrl(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`download ${r.status} em ${url.slice(-60)}`);
  return Buffer.from(await r.arrayBuffer());
}

/* ---------- arquivos grandes (bucket midias-grandes, chat-v16c) ----------
   sobe em FLUXO: o arquivo passa do WhatsApp para o Storage sem ficar inteiro na
   memória do motor (um .zip de 137 MB em buffer derrubaria o container). Aceita
   um Readable do Node ou um Buffer (os testes mandam Buffer). */
function urlPublicaEm(bucket, caminho) {
  return `${URL_BASE}/storage/v1/object/public/${bucket}/${caminho}`;
}
async function subirStream(bucket, caminho, corpo, mime, signal) {
  const { Readable } = require('stream');
  const body = Buffer.isBuffer(corpo) ? corpo : Readable.toWeb(corpo);
  const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${caminho}`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'content-type': mime || 'application/octet-stream', 'x-upsert': 'true' },
    body,
    signal,   // o prazo de quem chamou aborta a conexão de verdade (sem isso o envio seguia depois do "erro")
    ...(Buffer.isBuffer(corpo) ? {} : { duplex: 'half' })
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 180);
    if (r.status === 413 || /exceeded|too large|maximum size/i.test(txt)) {
      throw new Error('o Supabase recusou o arquivo por tamanho: aumente "Upload file size limit" em Storage → Settings (' + txt + ')');
    }
    throw new Error(`Storage ${r.status}: ${txt}`);
  }
  return urlPublicaEm(bucket, caminho);
}
async function apagarObjeto(bucket, caminho) {
  const r = await fetch(`${URL_BASE}/storage/v1/object/${bucket}/${caminho}`, {
    method: 'DELETE', headers: { apikey: KEY, Authorization: 'Bearer ' + KEY }
  });
  if (!r.ok && r.status !== 404) throw new Error(`Storage ${r.status} ao apagar ${caminho.slice(-40)}`);
}

function nomeArquivo(ext) {
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext ? '.' + ext : ''}`;
}

function extDoMime(mime) {
  const mapa = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/3gpp': '3gp', 'video/webm': 'webm',
    'audio/ogg': 'ogg', 'audio/ogg; codecs=opus': 'ogg', 'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a', 'audio/webm': 'webm', 'audio/wav': 'wav',
    'application/pdf': 'pdf'
  };
  if (mapa[mime]) return mapa[mime];
  const m = String(mime || '').split(';')[0].split('/')[1] || 'bin';
  return m.replace(/[^a-z0-9]/gi, '').slice(0, 5) || 'bin';
}

/* ---------- conversões com ffmpeg (para envio) ---------- */

function rodarFfmpeg(entrada, args) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg indisponível'));
    const p = spawn(ffmpegPath, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...args, 'pipe:1']);
    const chunks = [], erros = [];
    p.stdout.on('data', c => chunks.push(c));
    p.stderr.on('data', c => erros.push(c));
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0 && chunks.length) resolve(Buffer.concat(chunks));
      else reject(new Error('ffmpeg: ' + Buffer.concat(erros).toString().slice(0, 200)));
    });
    p.stdin.on('error', () => {});
    p.stdin.end(entrada);
  });
}

/* qualquer áudio do navegador (webm/mp4/ogg) → ogg/opus, formato do áudio de voz do WhatsApp */
function paraOpus(buffer) {
  return rodarFfmpeg(buffer, ['-vn', '-c:a', 'libopus', '-b:a', '32k', '-ar', '48000', '-ac', '1', '-f', 'ogg']);
}

/* imagem → figurinha webp 512x512 */
function paraFigurinha(buffer) {
  return rodarFfmpeg(buffer, [
    '-vf', "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000",
    '-c:v', 'libwebp', '-lossless', '0', '-q:v', '70', '-f', 'webp'
  ]);
}

/* ---------- transcrição de áudio (Groq Whisper, opcional) ---------- */

function transcricaoDisponivel() { return !!GROQ_KEY; }

async function transcrever(buffer, mime) {
  if (!GROQ_KEY) return '';
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mime || 'audio/ogg' }), 'audio.' + extDoMime(mime));
  form.append('model', 'whisper-large-v3');
  form.append('language', 'pt');
  form.append('response_format', 'json');
  const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + GROQ_KEY },
    body: form
  });
  if (!r.ok) throw new Error(`transcrição ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const j = await r.json();
  return (j.text || '').trim();
}

module.exports = {
  subirMidia, baixarUrl, nomeArquivo, extDoMime, urlPublica,
  subirStream, apagarObjeto, urlPublicaEm,
  paraOpus, paraFigurinha, transcrever, transcricaoDisponivel
};
