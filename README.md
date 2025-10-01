# DevSamurai Downloader

Ferramenta em Node.js para catalogar links de cursos [DevSamurai](https://class.devsamurai.com.br/), baixar tudo em lote e acompanhar o progresso em tempo real direto no terminal. Downloads interrompidos podem ser retomados graças aos arquivos `.part` reutilizados.

> **Aviso oficial (resumo)**: A DevSamurai encerrou a plataforma, liberou todo o conteúdo (~100 GB) para download até dezembro de 2025 e recomenda que os backups sejam feitos o quanto antes. Suporte: suporte@devsamurai.com.br.

## Pré‑requisitos

- Node.js 18+ (recomendado 20+)
- npm para instalar dependências (`npm install`)

## Uso rápido

```bash
npm install
node index.js
```

Por padrão os arquivos são baixados para `./output`. A interface ocupa o terminal inteiro enquanto os downloads estão ativos; use `↑ ↓ PgUp PgDn` para navegar entre as seções.

## Opções úteis

- `--parallel <n>` / `-p <n>` / `<n>`: Define quantos downloads simultâneos serão executados. Exemplo:
  ```bash
  node index.js --parallel 8
  ```
- `--retry-failed [n]` / `-r [n]`: Tenta novamente os downloads que falharem. Sem valor assume 1 nova tentativa.
- Interrompeu? Rode novamente o mesmo comando: as partes já baixadas são detectadas e o download é retomado.
