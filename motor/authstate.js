/* Motor — sessão do WhatsApp persistida no Supabase (tabela motor_sessao)
   Assim o Motor sobrevive a reinícios/redeploys sem pedir QR de novo. */

const { initAuthCreds, BufferJSON, proto } = require('@whiskeysockets/baileys');
const db = require('./db');

const serializar = (v) => JSON.parse(JSON.stringify(v, BufferJSON.replacer));
const desserializar = (v) => (v == null ? null : JSON.parse(JSON.stringify(v), BufferJSON.reviver));

async function ler(chave) {
  const rows = await db.select(`motor_sessao?chave=eq.${encodeURIComponent(chave)}&select=valor`);
  return rows && rows.length ? desserializar(rows[0].valor) : null;
}

async function gravar(chave, valor) {
  await db.upsert('motor_sessao', [{ chave, valor: serializar(valor), atualizado_em: new Date().toISOString() }]);
}

async function apagar(chave) {
  await db.del(`motor_sessao?chave=eq.${encodeURIComponent(chave)}`);
}

/* apaga o pareamento, mas PRESERVA a marca do RESETAR_SESSAO: se ela sumisse,
   o próximo boot acharia o token "novo" de novo e resetaria a sessão em laço */
async function limparSessao() {
  await db.del('motor_sessao?chave=neq.__reset_aplicado__');
}

async function useSupabaseAuthState() {
  const creds = (await ler('creds')) || initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (tipo, ids) => {
          const dados = {};
          for (const id of ids) {
            let v = await ler(`${tipo}-${id}`);
            if (tipo === 'app-state-sync-key' && v) v = proto.Message.AppStateSyncKeyData.fromObject(v);
            if (v) dados[id] = v;
          }
          return dados;
        },
        set: async (dados) => {
          for (const tipo in dados) {
            for (const id in dados[tipo]) {
              const v = dados[tipo][id];
              const chave = `${tipo}-${id}`;
              if (v) await gravar(chave, v);
              else await apagar(chave);
            }
          }
        }
      }
    },
    saveCreds: () => gravar('creds', creds)
  };
}

module.exports = { useSupabaseAuthState, limparSessao };
