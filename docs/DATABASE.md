# Modelo de Dados — connexto-axiom-agents

Banco de dados SQLite com WAL mode para suportar acesso concorrente entre o ciclo KAIROS (`main.ts`) e o Telegram bot (`bot.ts`).

Schema completo em `state/schema.sql`.

---

## Tabelas

### `goals`

Objetivos estrategicos ativos do sistema.

| Coluna      | Tipo          | Descricao                            |
| ----------- | ------------- | ------------------------------------ |
| id          | TEXT PK       | UUID                                 |
| title       | TEXT NOT NULL | Titulo do objetivo                   |
| description | TEXT          | Descricao detalhada                  |
| status      | TEXT          | `active`, `completed`, `cancelled`   |
| priority    | INTEGER       | Prioridade (maior = mais importante) |
| created_at  | TEXT          | Timestamp ISO 8601                   |
| updated_at  | TEXT          | Timestamp ISO 8601                   |

### `tasks`

Tarefas vinculadas a goals, atribuidas a agentes.

| Coluna      | Tipo          | Descricao                                       |
| ----------- | ------------- | ----------------------------------------------- |
| id          | TEXT PK       | UUID                                            |
| goal_id     | TEXT FK       | Referencia `goals.id` (CASCADE)                 |
| agent_id    | TEXT NOT NULL | ID do agente responsavel                        |
| title       | TEXT NOT NULL | Titulo da tarefa                                |
| description | TEXT          | Detalhes                                        |
| status      | TEXT          | `pending`, `in_progress`, `completed`, `failed` |
| created_at  | TEXT          | Timestamp                                       |
| updated_at  | TEXT          | Timestamp                                       |

### `decisions`

Historico de decisoes do KAIROS.

| Coluna     | Tipo          | Descricao                        |
| ---------- | ------------- | -------------------------------- |
| id         | TEXT PK       | UUID                             |
| task_id    | TEXT FK       | Referencia `tasks.id` (SET NULL) |
| agent_id   | TEXT NOT NULL | Agente que decidiu               |
| action     | TEXT NOT NULL | Acao decidida                    |
| reasoning  | TEXT          | Justificativa                    |
| created_at | TEXT          | Timestamp                        |

### `metrics`

Metricas genericas de agentes.

| Coluna       | Tipo          | Descricao       |
| ------------ | ------------- | --------------- |
| id           | TEXT PK       | UUID            |
| agent_id     | TEXT NOT NULL | ID do agente    |
| metric_name  | TEXT NOT NULL | Nome da metrica |
| metric_value | REAL NOT NULL | Valor numerico  |
| recorded_at  | TEXT          | Timestamp       |

### `outcomes`

Resultados de execucao de agentes com dados de performance.

| Coluna              | Tipo          | Descricao                    |
| ------------------- | ------------- | ---------------------------- |
| id                  | TEXT PK       | UUID                         |
| agent_id            | TEXT NOT NULL | Agente executor              |
| task                | TEXT NOT NULL | Descricao da tarefa          |
| status              | TEXT          | `success`, `failed`          |
| output              | TEXT          | Caminho do arquivo ou output |
| error               | TEXT          | Mensagem de erro (se falhou) |
| execution_time_ms   | INTEGER       | Tempo de execucao em ms      |
| tokens_used         | INTEGER       | Tokens consumidos            |
| artifact_size_bytes | INTEGER       | Tamanho do artefato gerado   |
| created_at          | TEXT          | Timestamp                    |

### `audit_log`

Trail de auditoria de seguranca para todas as execucoes.

| Coluna             | Tipo          | Descricao              |
| ------------------ | ------------- | ---------------------- |
| id                 | TEXT PK       | UUID                   |
| agent_id           | TEXT NOT NULL | Agente                 |
| action             | TEXT NOT NULL | Acao executada         |
| input_hash         | TEXT NOT NULL | Hash SHA-256 do input  |
| output_hash        | TEXT          | Hash SHA-256 do output |
| sanitizer_warnings | TEXT          | JSON array de avisos   |
| runtime            | TEXT          | `local` ou `openclaw`  |
| created_at         | TEXT          | Timestamp              |

### `budgets`

Orcamento mensal de tokens.

| Coluna       | Tipo        | Descricao                             |
| ------------ | ----------- | ------------------------------------- |
| id           | TEXT PK     | UUID                                  |
| period       | TEXT UNIQUE | Formato YYYY-MM                       |
| total_tokens | INTEGER     | Limite mensal                         |
| used_tokens  | INTEGER     | Tokens consumidos                     |
| hard_limit   | INTEGER     | 1 = kill switch ativo quando esgotado |
| created_at   | TEXT        | Timestamp                             |

### `token_usage`

Registro granular de consumo de tokens por agente/task.

| Coluna        | Tipo          | Descricao        |
| ------------- | ------------- | ---------------- |
| id            | TEXT PK       | UUID             |
| agent_id      | TEXT NOT NULL | Agente           |
| task_id       | TEXT NOT NULL | ID da task       |
| input_tokens  | INTEGER       | Tokens de input  |
| output_tokens | INTEGER       | Tokens de output |
| total_tokens  | INTEGER       | Total            |
| created_at    | TEXT          | Timestamp        |

### `agent_feedback`

Avaliacao de execucoes para feedback loop automatico.

| Coluna     | Tipo          | Descricao                       |
| ---------- | ------------- | ------------------------------- |
| id         | TEXT PK       | UUID                            |
| agent_id   | TEXT NOT NULL | Agente avaliado                 |
| task_type  | TEXT NOT NULL | Tipo normalizado da tarefa      |
| grade      | TEXT          | `SUCCESS`, `PARTIAL`, `FAILURE` |
| reasons    | TEXT          | JSON array de razoes            |
| created_at | TEXT          | Timestamp                       |

### `artifacts`

Conteudo gerado por agentes com workflow de aprovacao.

| Coluna      | Tipo          | Descricao                                                         |
| ----------- | ------------- | ----------------------------------------------------------------- |
| id          | TEXT PK       | UUID                                                              |
| agent_id    | TEXT NOT NULL | Agente criador                                                    |
| type        | TEXT          | `post`, `newsletter`, `landing`, `editorial_calendar`, `analysis` |
| title       | TEXT NOT NULL | Titulo                                                            |
| content     | TEXT NOT NULL | Conteudo completo                                                 |
| status      | TEXT          | `draft`, `approved`, `rejected`, `published`                      |
| metadata    | TEXT          | JSON com dados adicionais                                         |
| approved_by | TEXT          | Quem aprovou                                                      |
| approved_at | TEXT          | Quando foi aprovado                                               |
| created_at  | TEXT          | Timestamp                                                         |
| updated_at  | TEXT          | Timestamp                                                         |

### `publications`

Registro de artifacts publicados.

| Coluna       | Tipo    | Descricao                  |
| ------------ | ------- | -------------------------- |
| id           | TEXT PK | UUID                       |
| artifact_id  | TEXT FK | Referencia `artifacts.id`  |
| channel      | TEXT    | `x`, `linkedin`, `stub`    |
| status       | TEXT    | `published`, `failed`      |
| external_id  | TEXT    | ID na plataforma externa   |
| published_at | TEXT    | Timestamp da publicacao    |
| error        | TEXT    | Erro (se falhou)           |
| impressions  | INTEGER | Stub para metricas futuras |
| clicks       | INTEGER | Stub                       |
| likes        | INTEGER | Stub                       |
| created_at   | TEXT    | Timestamp                  |

### `marketing_metrics`

Dados de engagement por artifact.

| Coluna           | Tipo          | Descricao                 |
| ---------------- | ------------- | ------------------------- |
| id               | TEXT PK       | UUID                      |
| artifact_id      | TEXT FK       | Referencia `artifacts.id` |
| channel          | TEXT NOT NULL | Canal                     |
| impressions      | INTEGER       | Impressoes                |
| clicks           | INTEGER       | Cliques                   |
| engagement_score | REAL          | Score 0-100               |
| source           | TEXT          | `stub`, `manual`, `api`   |
| collected_at     | TEXT          | Timestamp                 |

### `marketing_feedback`

Grades de performance de conteudo por tipo de mensagem.

| Coluna           | Tipo          | Descricao                     |
| ---------------- | ------------- | ----------------------------- |
| id               | TEXT PK       | UUID                          |
| artifact_id      | TEXT FK       | Referencia `artifacts.id`     |
| message_type     | TEXT NOT NULL | Tipo (post, newsletter, etc.) |
| grade            | TEXT          | `STRONG`, `AVERAGE`, `WEAK`   |
| engagement_score | REAL          | Score que gerou o grade       |
| created_at       | TEXT          | Timestamp                     |

### `code_changes`

Mudancas de codigo propostas pelo FORGE no ciclo PR virtual.

| Coluna        | Tipo          | Descricao                                                                                 |
| ------------- | ------------- | ----------------------------------------------------------------------------------------- |
| id            | TEXT PK       | UUID                                                                                      |
| task_id       | TEXT NOT NULL | ID do goal que originou a mudanca                                                         |
| description   | TEXT NOT NULL | Descricao curta da mudanca                                                                |
| files_changed | TEXT NOT NULL | JSON array de paths afetados                                                              |
| diff          | TEXT          | JSON com before/after de cada arquivo                                                     |
| risk          | INTEGER       | 1-5 (risco estimado)                                                                      |
| status        | TEXT          | `pending`, `pending_approval`, `approved`, `applied`, `failed`, `rolled_back`, `rejected` |
| test_output   | TEXT          | stdout do lint (eslint + tsc)                                                             |
| error         | TEXT          | Mensagem de erro                                                                          |
| approved_by   | TEXT          | Quem aprovou                                                                              |
| approved_at   | TEXT          | Quando foi aprovado                                                                       |
| applied_at    | TEXT          | Quando foi aplicado                                                                       |
| created_at    | TEXT          | Timestamp                                                                                 |

---

## Indices

Cada tabela possui indices otimizados para as queries mais frequentes:

- `goals`: status
- `tasks`: status, goal_id, agent_id
- `decisions`: agent_id, task_id
- `metrics`: agent_id, metric_name
- `outcomes`: agent_id, status
- `audit_log`: agent_id, runtime
- `budgets`: period
- `token_usage`: agent_id, created_at
- `agent_feedback`: agent_id, task_type, created_at
- `artifacts`: agent_id, status, type
- `publications`: artifact_id, channel, status
- `marketing_metrics`: artifact_id, collected_at
- `marketing_feedback`: message_type, grade, created_at
- `code_changes`: status, created_at

## Concorrencia

O banco usa WAL mode (`PRAGMA journal_mode = WAL`) para permitir leitura/escrita concorrente entre:

- `src/main.ts` (ciclo KAIROS — escrita)
- `src/bot.ts` (Telegram bot — leitura + escrita de aprovacoes)
