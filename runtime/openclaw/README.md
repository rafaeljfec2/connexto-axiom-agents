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

## Hardening: Usuario Dedicado

Para ambientes de producao, criar um usuario isolado sem sudo:

```bash
./scripts/setup-openclaw-user.sh
```

O script cria o usuario `openclaw` com:
- Shell `/usr/sbin/nologin` (sem login interativo)
- Sem acesso a grupos `sudo`, `wheel` ou `admin`
- Home em `/home/openclaw` com permissoes 750
- Sandbox em `/home/openclaw/runtime/sandbox/forge`

Executar o gateway como usuario dedicado:

```bash
sudo -u openclaw openclaw gateway
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
OPENCLAW_API_KEY=seu-token-seguro-aqui
OPENCLAW_MODEL=gpt-4o-mini
```

## Iniciar o Gateway

```bash
openclaw gateway
```

O gateway inicia na porta 18789 (loopback apenas, inacessivel externamente).

## Verificar o Gateway

```bash
curl http://localhost:18789/health
```

## Executar com OpenClaw

Com o gateway rodando e `USE_OPENCLAW=true` no `.env`:

```bash
pnpm dev
```

## Executar sem OpenClaw (fallback local)

Setar `USE_OPENCLAW=false` no `.env`:

```bash
pnpm dev
```

## Estrutura

```
runtime/openclaw/
  config.json              # Configuracao do gateway e agente FORGE
  skills/
    forge-writer/
      SKILL.md             # Skill customizada para geracao de documentos
```

## Seguranca (Hardening)

### Camada 1: Usuario
- Usuario dedicado `openclaw` sem sudo
- Gateway roda sob usuario isolado

### Camada 2: Filesystem
- Workspace aponta para `/home/openclaw/runtime/sandbox/forge` (path absoluto)
- Validacao de filename: apenas `a-z0-9`, hifens e pontos
- Limite de 100 arquivos no sandbox
- Limite de 1 MB por arquivo
- Protecao contra path traversal (`../`)

### Camada 3: Rede
- Gateway bind em `loopback` (127.0.0.1 apenas)
- Autenticacao por token obrigatoria (`gateway.auth.mode: "token"`)
- Validacao anti-SSRF no client (rejeita hosts que nao sejam localhost)
- Portas restritas ao range 1024-65535

### Camada 4: Output do LLM
- Sanitizacao automatica antes de salvar em disco
- Remocao de blocos shell com comandos perigosos
- Remocao de URLs externas
- Deteccao de bytes nulos e conteudo binario
- Truncamento em 1 MB

### Camada 5: Auditoria
- Toda execucao registrada na tabela `audit_log`
- Hash SHA-256 do input (prompt) e output (conteudo gerado)
- Warnings do sanitizer registrados para investigacao
- Runtime identificado (`local` ou `openclaw`)

### Tools permitidas (FORGE)
- `read` (leitura no workspace)
- `write` (escrita no workspace)

### Tools bloqueadas (FORGE)
- `exec` (execucao de comandos)
- `edit` (edicao de arquivos fora do workspace)
- `apply_patch` (patches arbitrarios)
- `browser` (acesso web)
- `gateway` (controle do gateway)
- `process` (gerenciamento de processos)
