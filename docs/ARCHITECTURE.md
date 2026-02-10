# Arquitetura — connexto-axiom-agents

## Visao Geral

connexto-axiom-agents e um sistema operacional de execucao por IA. Agentes autonomos planejam, executam, avaliam e aprendem com tarefas reais — tudo rodando localmente com controle de custo, governanca humana e feedback loops rastreaveis.

## Principios Fundamentais

1. **Previsibilidade > Conveniencia** — nenhum agente executa sem orcamento validado
2. **Estado > Historico** — o LLM recebe estado atual comprimido, nunca historico bruto
3. **Menos contexto e melhor** — prompts minimalistas com templates estritos
4. **Nenhuma acao irreversivel sem aprovacao** — publicacoes e mudancas de codigo de alto risco exigem aprovacao humana
5. **Feedback vem de dados, nao texto** — ajustes automaticos sao matematicos, nao textuais

## Diagrama de Arquitetura

```
src/main.ts              Kairos cycle entry point (one-shot via cron)
src/bot.ts               Telegram bot entry point (persistent long-polling)
                              |
             ┌────────────────┼────────────────┐
             v                v                v
         KAIROS           FORGE            VECTOR
       (orquestrador)  (executor tecnico) (executor marketing)
             |                |                |
             v                v                v
       ┌──────────┐    ┌──────────────┐  ┌──────────┐
       │ Decisions │    │ Outcomes     │  │ Artifacts│
       │ Feedback  │    │ Sandbox      │  │ Drafts   │
       │ Metrics   │    │ Audit        │  │ Publish  │
       │           │    │ Code Changes │  │ Metrics  │
       └──────────┘    └──────────────┘  └──────────┘
             │                │                │
             └────────────────┼────────────────┘
                              v
                       SQLite (WAL mode)
                              |
                              v
                    Telegram (Daily Briefing)
```

## Fluxo do Ciclo KAIROS

```
1. main.ts abre DB + valida budget
2. runKairos carrega goals ativos + decisoes recentes
3. stateCompressor comprime estado (max 3 goals, 3 acoes)
4. kairosLLM envia prompt comprimido ao LLM (OpenAI/Claude)
5. validateKairos valida JSON de saida
6. decisionFilter filtra delegacoes (impact/cost/risk)
   - feedbackAdjuster aplica ajustes de execucao
   - marketingFeedbackAdjuster aplica ajustes de marketing (VECTOR)
7. budgetGate verifica orcamento antes de cada execucao
8. forgeExecutor / vectorExecutor executam via OpenClaw ou local
9. forgeEvaluator avalia resultado (SUCCESS/PARTIAL/FAILURE)
10. agentFeedback persiste avaliacao
11. dailyBriefing formata e envia via Telegram
```

## Modelo de Seguranca

### Sandbox

Cada agente opera em um diretorio isolado (`sandbox/<agent>/`). O OpenClaw restringe acesso ao workspace do agente.

### Output Sanitization

Todo output de LLM passa por `outputSanitizer.ts`:

- Remove null bytes e conteudo binario
- Bloqueia comandos shell perigosos (rm, sudo, curl|bash)
- Remove URLs externas
- Aplica limite de tamanho (1MB)

### Audit Trail

Toda execucao gera registro em `audit_log` com:

- Hash do input e output
- Avisos do sanitizador
- Runtime usado (local/openclaw)

### Budget Gate

Antes de qualquer execucao de agente:

- Verifica orcamento mensal
- Verifica limite por agente
- Verifica limite diario de tasks
- Kill switch se budget esgotado

## Stack Tecnologico

| Componente       | Tecnologia                                  |
| ---------------- | ------------------------------------------- |
| Runtime          | Node.js >= 24 + TypeScript 5.9 (ESM)        |
| Banco de Dados   | SQLite com WAL mode (better-sqlite3)        |
| Runtime LLM      | OpenClaw (execucao isolada de agentes)      |
| LLM Providers    | OpenAI (gpt-4o-mini), Claude (via fallback) |
| Agendamento      | Cron (ciclos one-shot)                      |
| Interface Humana | Telegram Bot (long-polling)                 |
| Logging          | Pino (JSON estruturado)                     |
| Linting          | ESLint 9 + Prettier 3                       |

## Agentes

| Agente       | Papel                                                         | Status    |
| ------------ | ------------------------------------------------------------- | --------- |
| **KAIROS**   | Orquestrador estrategico — decide, delega, avalia             | Ativo     |
| **FORGE**    | Executor tecnico — gera codigo, docs, configs via OpenClaw    | Ativo     |
| **VECTOR**   | Executor de marketing — gera posts, newsletters, landing copy | Ativo     |
| **SENTINEL** | Monitor de seguranca e compliance                             | Planejado |
| **NEXUS**    | Conector de integracoes e dados                               | Planejado |
| **COVENANT** | Governanca e politicas                                        | Planejado |
