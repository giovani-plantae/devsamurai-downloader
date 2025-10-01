# DevSamurai Downloader

Ferramenta em Node.js para catalogar links de cursos DevSamurai, baixar tudo em lote e acompanhar o progresso em tempo real direto no terminal. Downloads interrompidos podem ser retomados graças aos arquivos `.part` reutilizados.

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
- Interrompeu? Rode novamente o mesmo comando: as partes já baixadas são detectadas e o download é retomado.