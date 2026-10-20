#!/usr/bin/env python3
"""Fixa a versão do front nos 3 lugares: ?v= do index.html, APP_VERSAO de js/main.js e versao.json.

Uso: python3 nuvem/versao.py X.Y.Z
Sai com código 1 se o formato for inválido ou se algum padrão não for encontrado.
"""
import json
import os
import re
import sys

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def ler(rel):
    with open(os.path.join(RAIZ, rel), encoding='utf-8') as f:
        return f.read()


def gravar(rel, texto):
    with open(os.path.join(RAIZ, rel), 'w', encoding='utf-8') as f:
        f.write(texto)


def main(argv):
    if len(argv) != 2 or not re.fullmatch(r'\d+\.\d+\.\d+', argv[1]):
        print('uso: python3 nuvem/versao.py X.Y.Z', file=sys.stderr)
        return 1
    v = argv[1]

    html, n_html = re.subn(r'\?v=[0-9.]+', '?v=' + v, ler('index.html'))
    main_js, n_main = re.subn(r"APP_VERSAO = '[^']+'", "APP_VERSAO = '" + v + "'", ler('js/main.js'))
    print('index.html: %d troca(s)' % n_html)
    print('js/main.js: %d troca(s)' % n_main)
    if n_html == 0 or n_main == 0:
        print('erro: padrão não encontrado; nada foi gravado', file=sys.stderr)
        return 1

    gravar('index.html', html)
    gravar('js/main.js', main_js)
    gravar('versao.json', json.dumps({'versao': v}, separators=(',', ':')) + '\n')
    print('versao.json: %s' % v)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
