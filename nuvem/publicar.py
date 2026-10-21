#!/usr/bin/env python3
# ============================================================
# mv-sistema — Publicador (deploy na Vercel via API)
# Uso:  python3 nuvem/publicar.py [--sim]    (produção; --sim pula a pergunta)
# Token: lido de ~/.mv-vercel-token ou da variável VERCEL_TOKEN
#        (token do ESCRITÓRIO, no escopo do time do escritório)
# ============================================================
import base64
import json
import os
import sys
import time
import urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJETO = 'mv-sistema'
TEAM_ID = 'team_Cn3hyRNyzIiTDvONqVN0dQZ0'   # time do escritório na Vercel
IGNORAR_DIRS = {'nuvem', 'motor', 'testes', '.claude', '.superpowers', '.git', '__pycache__', 'node_modules'}
IGNORAR_ARQS = {'LEIA-ME.md', 'DESIGN.md', 'CLAUDE.md', '.vercelignore', '.DS_Store'}


def token():
    t = os.environ.get('VERCEL_TOKEN', '').strip()
    if t:
        return t
    caminho = os.path.expanduser('~/.mv-vercel-token')
    if os.path.exists(caminho):
        return open(caminho).read().strip()
    sys.exit('Token da Vercel do ESCRITÓRIO não encontrado — gere um token no escopo do time do escritório '
             'e salve em ~/.mv-vercel-token (ou defina VERCEL_TOKEN). Nunca usar token de outra operação.')


def coletar_arquivos():
    arquivos = []
    for pasta, dirs, nomes in os.walk(RAIZ):
        dirs[:] = [d for d in dirs if d not in IGNORAR_DIRS and not d.startswith('.')]
        for nome in nomes:
            if nome in IGNORAR_ARQS or nome.startswith('.'):
                continue
            caminho = os.path.join(pasta, nome)
            rel = os.path.relpath(caminho, RAIZ)
            with open(caminho, 'rb') as f:
                dados = f.read()
            arquivos.append({
                'file': rel.replace(os.sep, '/'),
                'data': base64.b64encode(dados).decode(),
                'encoding': 'base64'
            })
    return arquivos


def api(metodo, caminho, corpo=None):
    if TEAM_ID:
        caminho += ('&teamId=' if '?' in caminho else '?teamId=') + TEAM_ID
    req = urllib.request.Request(
        'https://api.vercel.com' + caminho,
        data=json.dumps(corpo).encode() if corpo is not None else None,
        method=metodo,
        headers={'Authorization': 'Bearer ' + token(), 'Content-Type': 'application/json'}
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        detalhe = e.read().decode()[:400]
        sys.exit(f'Erro da Vercel ({e.code}): {detalhe}')


def main():
    if not TEAM_ID:
        sys.exit('TEAM_ID vazio — preencha TEAM_ID na ativação (id do time do escritório na Vercel).')
    arquivos = coletar_arquivos()
    print(f'Time: {TEAM_ID} · Projeto: {PROJETO} · {len(arquivos)} arquivo(s)')
    if '--sim' not in sys.argv:
        if not sys.stdin.isatty():
            sys.exit('Sem terminal: rode com --sim para confirmar a publicação')
        input('Enter para publicar, Ctrl+C para sair ')
    corpo = {
        'name': PROJETO,
        'files': arquivos,
        'target': 'production',
        'projectSettings': {'framework': None}
    }
    dep = api('POST', '/v13/deployments', corpo)
    dep_id = dep['id']
    print(f'Deploy iniciado: {dep_id}')
    for _ in range(60):
        info = api('GET', f'/v13/deployments/{dep_id}')
        estado = info.get('readyState') or info.get('status')
        if estado == 'READY':
            url = info.get('url', '')
            aliases = api('GET', f'/v2/deployments/{dep_id}/aliases').get('aliases', [])
            print('PUBLICADO')
            print('   URL do deploy : https://' + url)
            for a in aliases:
                print('   Endereço fixo : https://' + a.get('alias', ''))
            return
        if estado in ('ERROR', 'CANCELED'):
            sys.exit(f'Deploy falhou: {estado}')
        time.sleep(3)
    sys.exit('Tempo esgotado aguardando o deploy.')


if __name__ == '__main__':
    main()
