# Telegram Bot — connexto-axiom-agents

O bot Telegram e a interface humana principal do sistema. Roda como processo persistente (`src/bot.ts`) em paralelo com o ciclo KAIROS (`src/main.ts`), compartilhando o banco SQLite via WAL mode.

## Iniciar

```bash
pnpm bot
```

## Configuracao

Variaveis de ambiente necessarias em `.env`:

```
TELEGRAM_BOT_TOKEN=<token do BotFather>
TELEGRAM_CHAT_ID=<chat_id autorizado>
```

Apenas o `chat_id` autorizado pode executar comandos. Tentativas de outros chats sao logadas como warning.

## Comandos

### Drafts e Aprovacao (VECTOR)

| Comando         | Descricao                                      |
| --------------- | ---------------------------------------------- |
| `/drafts`       | Lista todos os drafts pendentes de aprovacao   |
| `/approve <id>` | Aprova um draft (muda status para `approved`)  |
| `/reject <id>`  | Rejeita um draft (muda status para `rejected`) |
| `/publish <id>` | Publica um artifact aprovado (stub v1)         |

### Metricas de Marketing

| Comando                                             | Descricao                                  |
| --------------------------------------------------- | ------------------------------------------ |
| `/metrics <id> <impressions> <clicks> <engagement>` | Registra metricas manuais para um artifact |

Parametros:

- `id` — ID do artifact (aceita parcial, primeiros 8 chars)
- `impressions` — numero de impressoes (>= 0)
- `clicks` — numero de cliques (>= 0)
- `engagement` — score de engajamento (0-100)

### Mudancas de Codigo (FORGE)

| Comando                | Descricao                                       |
| ---------------------- | ----------------------------------------------- |
| `/changes`             | Lista mudancas de codigo pendentes de aprovacao |
| `/approve_change <id>` | Aprova e aplica uma mudanca de codigo           |
| `/reject_change <id>`  | Rejeita uma mudanca de codigo                   |

### Geral

| Comando | Descricao                            |
| ------- | ------------------------------------ |
| `/help` | Mostra todos os comandos disponiveis |

## IDs Parciais

Todos os comandos que aceitam `<id>` funcionam com IDs parciais (primeiros 8 caracteres do UUID). Se houver ambiguidade (mais de um match), o comando falha com erro.

## Fluxo de Aprovacao de Draft

```
VECTOR gera draft → /drafts lista → /approve <id> → /publish <id> → publicado
                                   → /reject <id> → rejeitado
```

## Fluxo de Aprovacao de Codigo

```
FORGE gera plano (risk >= 3) → notificacao automatica no Telegram
                              → /changes lista pendentes
                              → /approve_change <id> → aplica + lint
                              → /reject_change <id> → rejeitado
```

## Daily Briefing

O briefing diario e enviado automaticamente ao final de cada ciclo KAIROS via `sendTelegramMessage()`. Contem:

1. Resumo do ciclo
2. Decisoes pendentes
3. Delegacoes aprovadas / aguardando aprovacao / descartadas
4. Execucoes FORGE (resultados)
5. Mudancas de Codigo FORGE (aplicadas, pendentes, falhas, risco)
6. Execucoes VECTOR (resultados, drafts, publicacoes, performance)
7. Orcamento LLM (tokens usados, % restante, avisos)
8. Eficiencia LLM (tokens/decisao, media 7d)
9. Feedback (taxa de sucesso por agente, tasks problematicas)
10. Foco nas proximas 24h
