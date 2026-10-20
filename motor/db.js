/* Motor — acesso ao Supabase (service role, ignora RLS) */

const URL_BASE = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

/* tempo máximo por chamada: sem isto um fetch pendurado travava a fila,
   a recepção e os comandos para sempre (as travas "enviando/processando" nunca soltavam) */
const TEMPO_LIMITE = 15000;
/* esperas entre as novas tentativas (erro de rede, timeout, 408/425/429/5xx) */
const ESPERAS = [400, 1200, 3000];

/* última resposta OK do banco — a checagem de saúde usa para saber se o Supabase responde */
let ultimoOk = 0;

function configurado() {
  return !!(URL_BASE && KEY && KEY !== 'PENDENTE' && KEY.length > 40);
}

const dormir = (ms) => new Promise(r => setTimeout(r, ms));

/* tira o conteúdo da linha que o Postgres ecoa em violação de restrição
   ("Failing row contains (...)") — o erro vai para o log e não pode levar texto de cliente */
const semLinha = (t) => String(t || '').replace(/Failing row contains(?:\\.|[^"\\])*/g, 'Failing row contains (omitido)');

async function req(metodo, caminho, corpo, prefer) {
  const headers = {
    apikey: KEY,
    Authorization: 'Bearer ' + KEY,
    'content-type': 'application/json'
  };
  if (prefer) headers.Prefer = prefer;
  let r, txt;
  try {
    r = await fetch(`${URL_BASE}/rest/v1/${caminho}`, {
      method: metodo,
      headers,
      body: corpo != null ? JSON.stringify(corpo) : undefined,
      signal: AbortSignal.timeout(TEMPO_LIMITE)
    });
    txt = await r.text();
  } catch (e) {
    // sem resposta (rede caiu ou estourou o tempo): status 0 = "pode tentar de novo"
    const erro = new Error(`Supabase sem resposta em ${caminho.split('?')[0]}: ${e.name === 'TimeoutError' ? 'tempo esgotado' : e.message}`);
    erro.status = 0;
    erro.code = '';
    throw erro;
  }
  if (!r.ok) {
    // o PostgREST devolve {"code":"23505",...}: o motor decide pelo código, não pelo texto
    let code = '';
    try { const j = JSON.parse(txt); code = j && j.code != null ? String(j.code) : ''; } catch (e) { /* corpo não-JSON */ }
    const erro = new Error(`Supabase ${r.status} em ${caminho.split('?')[0]}: ${semLinha(txt).slice(0, 200)}`);
    erro.status = r.status;
    erro.code = code;
    throw erro;
  }
  ultimoOk = Date.now();
  return txt ? JSON.parse(txt) : null;
}

/* vale a pena tentar de novo? só falha passageira (rede/timeout, 408, 425, 429, 5xx) */
function passageiro(e) {
  const s = e && e.status;
  return s === 0 || s === 408 || s === 425 || s === 429 || (s >= 500 && s <= 599);
}

/* até 3 novas tentativas com espera crescente. NÃO usar em insert: se a primeira
   chegou ao banco e só a resposta se perdeu, repetir duplicaria a linha */
async function comNovaTentativa(fn) {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e) {
      if (i >= ESPERAS.length || !passageiro(e)) throw e;
      await dormir(ESPERAS[i]);
    }
  }
}

const select = (caminho) => comNovaTentativa(() => req('GET', caminho));
const insert = (tabela, linhas) => req('POST', tabela, linhas, 'return=representation');   // sem nova tentativa (poderia duplicar)
const upsert = (tabela, linhas) => comNovaTentativa(() => req('POST', tabela, linhas, 'resolution=merge-duplicates,return=minimal'));
const patch = (caminho, corpo) => comNovaTentativa(() => req('PATCH', caminho, corpo, 'return=minimal'));
const del = (caminho) => comNovaTentativa(() => req('DELETE', caminho, null, 'return=minimal'));
/* função do banco (POST /rest/v1/rpc/<nome>) — ex.: registrar_entrada (chat-v12a) */
const rpc = (nome, args) => comNovaTentativa(() => req('POST', 'rpc/' + nome, args || {}));

/* para a checagem de saúde do motor */
const saude = () => ({ ultimoOk });

/* cria um login no Supabase Auth (Admin API — só o motor tem a chave mestra) */
async function criarUsuarioAuth(email, senha, nome) {
  const r = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: { nome } }),
    signal: AbortSignal.timeout(TEMPO_LIMITE)
  });
  const txt = await r.text();
  let dados = null;
  try { dados = txt ? JSON.parse(txt) : null; } catch (e) { /* resposta não-JSON */ }
  if (!r.ok) {
    const msg = String((dados && (dados.msg || dados.message || dados.error_description || dados.error)) || txt.slice(0, 200));
    if (/already|email_exists|registered/i.test(msg)) throw new Error('já existe um login com o e-mail ' + email + ' — confira a lista de usuários');
    throw new Error('o Supabase recusou a criação do login (' + r.status + '): ' + msg.slice(0, 160));
  }
  if (!dados || !dados.id) throw new Error('o Supabase não devolveu o id do novo usuário');
  return dados;
}

async function excluirUsuarioAuth(id) {
  const r = await fetch(`${URL_BASE}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: KEY, Authorization: 'Bearer ' + KEY },
    signal: AbortSignal.timeout(TEMPO_LIMITE)
  });
  if (!r.ok && r.status !== 404) {  // 404 = login já não existe; seguimos p/ limpar o perfil
    const txt = await r.text();
    throw new Error('o Supabase recusou a exclusão (' + r.status + '): ' + txt.slice(0, 200));
  }
}

module.exports = { configurado, select, insert, upsert, patch, del, rpc, saude, criarUsuarioAuth, excluirUsuarioAuth };
