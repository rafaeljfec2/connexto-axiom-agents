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
         ┌────────────────────────┼────────────────────────┐
         v                        v                        v
     KAIROS                   FORGE                    VECTOR
   (orquestrador)          (executor tecnico)       (executor marketing)
    gpt-5.2                gpt-5.3-codex             gpt-4o-mini
   + historico               + OpenClaw
         |                        |                        |
         |    ┌───────────────────┤                        |
         v    v                   v                        v
       NEXUS                ┌──────────────┐         ┌──────────┐
    (pesquisador)           │ Workspaces   │         │ Artifacts│
    gpt-4o-mini             │ Git Branches │         │ Drafts   │
         |                  │ Code Changes │         │ Publish  │
         v                  │ Real Code    │         │ Metrics  │
   ┌──────────┐             └──────────────┘         └──────────┘
   │ Research │                   │                        │
   │ Analysis │                   │                        │
   └──────────┘                   │                        │
         │                        │                        │
         └────────────────────────┼────────────────────────┘
                                  v
                           SQLite (WAL mode)
                                  |
                                  v
                        Telegram (Daily Briefing)
```

## Fluxo do Ciclo KAIROS

```
1. main.ts abre DB + valida budget
2. Carrega manifestos de projetos, sincroniza com DB
3. Resolve projeto ativo (max 1 por ciclo)
4. runKairos carrega goals do projeto + decisoes recentes
5. stateCompressor comprime estado (max 3 goals, 3 acoes)
6. buildHistoricalContext agrega historico de execucoes (7d)
7. kairosLLM envia prompt comprimido + historico ao LLM (gpt-5.2)
8. validateKairos valida JSON de saida
9. decisionFilter filtra delegacoes (impact/cost/risk)
   - feedbackAdjuster aplica ajustes de execucao
   - marketingFeedbackAdjuster aplica ajustes de marketing (VECTOR)
10. budgetGate verifica orcamento antes de cada execucao
11. nexusExecutor executa pesquisas tecnicas (se delegadas)
12. forgeExecutor executa codigo no workspace isolado do projeto:
    - Clona repo_source para workspace
    - Descobre arquivos reais (5 estrategias)
    - Gera search/replace edits via gpt-5.3-codex
    - Aplica, lint, commit, push branch para review
13. vectorExecutor gera conteudo de marketing
14. Avaliadores classificam resultados (SUCCESS/PARTIAL/FAILURE)
15. agentFeedback persiste avaliacao
16. dailyBriefing formata e envia via Telegram (com historico)
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

| Componente       | Tecnologia                                                   |
| ---------------- | ------------------------------------------------------------ |
| Runtime          | Node.js >= 24 + TypeScript 5.9 (ESM)                         |
| Banco de Dados   | SQLite com WAL mode (better-sqlite3)                         |
| Runtime LLM      | OpenClaw (execucao isolada de agentes)                       |
| LLM Providers    | OpenAI (gpt-5.2, gpt-5.3-codex, gpt-4o-mini)               |
| Version Control  | Git (workspaces isolados, branch por task)                   |
| Agendamento      | Cron (ciclos one-shot)                                       |
| Interface Humana | Telegram Bot (long-polling)                                  |
| Logging          | Pino (JSON estruturado)                                      |
| Linting          | ESLint 9 + Prettier 3                                        |

## Agentes

| Agente       | Papel                                                                    | Modelo LLM       | Status    |
| ------------ | ------------------------------------------------------------------------ | ----------------- | --------- |
| **KAIROS**   | Orquestrador estrategico — decide com contexto historico, delega, avalia | `gpt-5.2`         | Ativo     |
| **FORGE**    | Executor tecnico — le codigo real, gera search/replace diffs via OpenClaw | `gpt-5.3-codex`   | Ativo     |
| **NEXUS**    | Pesquisador tecnico — analisa opcoes, trade-offs e riscos                | `gpt-4o-mini`     | Ativo     |
| **VECTOR**   | Executor de marketing — gera posts, newsletters, landing copy            | `gpt-4o-mini`     | Ativo     |
| **SENTINEL** | Monitor de seguranca e compliance                                        | —                 | Planejado |
| **COVENANT** | Governanca e politicas                                                   | —                 | Planejado |
