# DevSamurai Downloader

Ferramenta CLI em Node.js para baixar, em lote, todos os cursos disponibilizados pela DevSamurai e acompanhar o progresso em tempo real no terminal.

> **Aviso oficial (resumo)**: a DevSamurai encerrou a plataforma, liberou o conteúdo (~100 GB) para download até dezembro de 2025 e recomenda fazer backup o quanto antes. Suporte: suporte@devsamurai.com.br.

## Features

- Scraper automático de links `.zip` na página oficial.
- Retomada de downloads interrompidos (arquivos `.part`).
- Interface fullscreen estilo npm/docker (spinner, barras, ETA, navegação por setas).
- Concorrência configurável e retentativas automáticas para falhas.

## Como usar

```bash
git clone https://github.com/giovani-plantae/devsamurai-downloader.git
cd devsamurai-downloader
npm install
node index.js
```

## Parâmetros

- `--parallel <n>` / `-p <n>` / `<n>`
  - Define quantos downloads simultâneos rodar (padrão: 5).
- `--retry-failed [n]` / `-r [n]`
  - Habilita novas tentativas para arquivos que falharem (sem valor = 1 nova tentativa).

Exemplo:

```bash
node index.js --parallel 8 --retry-failed 2
```
