# OpenClaw Runtime - FORGE

Configuracao do OpenClaw como runtime de execucao para o agente FORGE.

## Pre-requisitos

- Node.js >= 24
- pnpm
- OpenClaw CLI instalado globalmente

## Instalacao do OpenClaw

```bash
pnpm add -g openclaw@latest
```

## Configuracao

1. Copiar a configuracao para o diretorio do OpenClaw:

```bash
mkdir -p ~/.openclaw
cp runtime/openclaw/config.json ~/.openclaw/openclaw.json
```

2. Configurar as variaveis de ambiente no `.env`:

```
USE_OPENCLAW=true
OPENCLAW_ENDPOINT=http://localhost:18789
OPENCLAW_API_KEY=
OPENCLAW_MODEL=gpt-4o-mini
```

## Iniciar o Gateway

```bash
openclaw gateway
```

O gateway inicia na porta 18789 (loopback).

## Verificar o Gateway

```bash
curl http://localhost:18789/health
```

## Executar com OpenClaw

Com o gateway rodando e `USE_OPENCLAW=true` no `.env`:

```bash
pnpm dev
```

O FORGE sera executado via OpenClaw, gerando conteudo inteligente com LLM.

## Executar sem OpenClaw (fallback local)

Setar `USE_OPENCLAW=false` no `.env`:

```bash
pnpm dev
```

O FORGE usa o executor local (template simples, sem LLM).

## Estrutura

```
runtime/openclaw/
  config.json              # Configuracao do gateway e agente FORGE
  skills/
    forge-writer/
      SKILL.md             # Skill customizada para geracao de documentos
```

## Seguranca

- FORGE so tem acesso as tools `read` e `write`
- Tools destrutivas (`exec`, `edit`, `browser`) estao bloqueadas
- Workspace isolado em `sandbox/forge/`
- OpenClaw nunca acessa o banco do connexto-axiom
- OpenClaw nunca ve objetivos globais
