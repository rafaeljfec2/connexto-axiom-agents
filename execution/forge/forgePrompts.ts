import type { KairosDelegation } from "../../orchestration/types.js";
import type { FileContext } from "../discovery/fileDiscovery.js";
import type { ForgePlan } from "./forgeTypes.js";
import { MAX_LINT_ERROR_CHARS } from "./forgeTypes.js";

export interface CorrectionAttempt {
  readonly round: number;
  readonly errorType: "apply" | "validation" | "test";
  readonly errorSummary: string;
}

export function buildPlanningSystemPrompt(language: string, framework: string): string {
  return [
    "Voce e o FORGE, agente de planejamento do sistema connexto-axiom.",
    `Voce esta analisando um projeto ${language}/${framework}.`,
    "Sua funcao nesta etapa e PLANEJAR a mudanca, NAO executar.",
    "Gere APENAS JSON valido. Nenhum texto, nenhum markdown, nenhuma explicacao fora do JSON.",
    "",
    "Formato de saida OBRIGATORIO (JSON puro, sem fences):",
    "{",
    '  "plan": "Descricao curta do que precisa ser feito (max 200 chars)",',
    '  "files_to_read": ["caminho/do/arquivo1.ts", "caminho/do/arquivo2.tsx"],',
    '  "files_to_modify": ["caminho/do/arquivo1.ts"],',
    '  "files_to_create": [],',
    '  "approach": "Descricao da abordagem tecnica (max 300 chars)",',
    '  "estimated_risk": 2,',
    '  "dependencies": ["Dependencia ou verificacao necessaria"]',
    "}",
    "",
    "REGRAS:",
    "- files_to_read: TODOS os arquivos que voce precisa ver para entender o contexto.",
    "  Inclua: componentes pai/filho, arquivos de config, rotas, tipos, layouts, etc.",
    "  Se a tarefa e sobre UI (sidebar, menu, etc), leia o componente E onde ele e usado.",
    "- files_to_modify: Apenas os arquivos que serao alterados.",
    "- files_to_create: Apenas arquivos novos que precisam ser criados.",
    "- Escolha paths REAIS baseados na arvore de arquivos fornecida.",
    "- NAO invente paths que nao existem na arvore.",
    "- estimated_risk: 1 (trivial) a 5 (alto impacto).",
    "- Se a tarefa ja foi implementada no codigo, defina files_to_modify como VAZIO [].",
    "",
    "REGRAS ANTI-ALUCINACAO:",
    "- Se a tarefa menciona 'theme', 'dark mode', 'cores', 'palette', 'tokens de cor':",
    "  Busque arquivos com 'theme', 'color', 'palette', 'token', 'style' no NOME ou EXPORTS.",
    "  NAO confunda com configs de infraestrutura (logger, database, cache, throttle).",
    "- Se a tarefa menciona 'sidebar', 'menu', 'nav':",
    "  Busque componentes de layout, nao configs de backend.",
    "- SEMPRE verifique se o NOME do arquivo e seus EXPORTS tem relacao direta com o tema da tarefa.",
    "- Configs de logger, throttle, rate-limit, database, cache NAO sao arquivos de UI/tema.",
    "- Priorize arquivos cujo NOME contem palavras-chave da tarefa.",
  ].join("\n");
}

function computeTreeMaxChars(hasIndex: boolean, hasPreview: boolean): number {
  if (hasIndex) return 2000;
  if (hasPreview) return 3000;
  return 4000;
}

export function buildPlanningUserPrompt(
  delegation: KairosDelegation,
  fileTree: string,
  allowedDirs: readonly string[],
  previewFiles: readonly FileContext[] = [],
  indexPromptSection: string = "",
  nexusContextSection: string = "",
  goalSection: string = "",
): string {
  const hasIndex = indexPromptSection.length > 0;
  const hasPreview = previewFiles.length > 0;
  const treeMaxChars = computeTreeMaxChars(hasIndex, hasPreview);

  const lines = [
    `Tarefa: ${delegation.task}`,
    `Resultado esperado: ${delegation.expected_output}`,
    `Goal ID: ${delegation.goal_id}`,
  ];

  if (goalSection.length > 0) {
    lines.push(goalSection);
  }

  lines.push("");

  if (nexusContextSection.length > 0) {
    lines.push(nexusContextSection);
  }

  if (hasIndex) {
    lines.push(
      "INDICE DE ARQUIVOS (exports por arquivo):",
      indexPromptSection,
      "",
      "Use este indice para identificar EXATAMENTE quais arquivos contem o codigo relevante.",
      "NAO invente paths. Use APENAS paths que existem neste indice ou na estrutura abaixo.",
      "",
    );
  }

  if (hasPreview) {
    lines.push("PREVIEW DE ARQUIVOS MAIS RELEVANTES:");
    for (const file of previewFiles) {
      lines.push(
        `--- ${file.path} (score: ${file.score}) ---`,
        file.content,
        "--- end ---",
        "",
      );
    }
    lines.push(
      "Use o preview acima para decidir se estes arquivos sao relevantes para a tarefa.",
      "Se a tarefa JA esta implementada no codigo mostrado, defina files_to_modify como VAZIO [].",
      "",
    );
  }

  lines.push(
    "ESTRUTURA DO PROJETO:",
    fileTree.slice(0, treeMaxChars),
    "",
    `Diretorios permitidos para escrita: ${allowedDirs.join(", ")}`,
    "",
    "Analise a tarefa e a estrutura do projeto.",
    "Identifique quais arquivos voce precisa LER para entender o contexto,",
    "e quais arquivos precisa MODIFICAR ou CRIAR.",
    hasIndex
      ? "IMPORTANTE: Consulte o INDICE DE ARQUIVOS acima para escolher paths REAIS com exports relevantes."
      : "",
    "Responda APENAS com JSON puro.",
  );

  return lines.join("\n");
}

export function buildExecutionSystemPrompt(
  language: string,
  framework: string,
  allowedDirs: readonly string[],
): string {
  return [
    "Voce e o FORGE, agente de codificacao do sistema connexto-axiom.",
    `Voce esta trabalhando no codigo REAL de um projeto ${language}/${framework}.`,
    "NAO use tools. O contexto necessario esta no prompt (arvore de arquivos + conteudo).",
    "Gere APENAS JSON valido. Nenhum texto, nenhum markdown, nenhuma explicacao fora do JSON.",
    "O codigo deve ser funcional, limpo e seguir os padroes do projeto.",
    `Diretorios permitidos para escrita: ${allowedDirs.join(", ")}`,
    "Paths devem ser relativos a raiz do projeto.",
    "Use imports relativos consistentes com o projeto existente.",
    "",
    "REGRAS DE FORMATO POR ACAO:",
    "",
    '1. Para action "create": use o campo "content" com o arquivo completo.',
    '2. Para action "modify": use o campo "edits" com blocos search/replace.',
    '   Cada edit tem "search" (trecho do arquivo original) e "replace" (trecho que substitui).',
    '   Opcionalmente, adicione "line" e "endLine" para edits baseados em numero de linha.',
    '   REGRA CRITICA para "search":',
    "   - Copie o trecho EXATAMENTE como aparece no codigo fornecido no prompt.",
    "   - Inclua pelo menos 2-3 linhas ANTES e DEPOIS da linha que voce quer mudar.",
    "   - NAO invente codigo. Copie literalmente do contexto fornecido.",
    "   - Preserve a indentacao original (espacos/tabs).",
    '   Para remover codigo, use "replace" como string vazia "".',
    '   Para remover uma linha do meio, inclua as linhas ao redor no search E no replace (sem a linha removida).',
    '   NUNCA use "content" para modify. Sempre use "edits".',
    "",
    "REGRA IMPORTANTE - Efeitos cascata:",
    "Ao remover codigo, verifique se a mudanca cria efeitos colaterais:",
    "- Se remover o uso de um import, ADICIONE um edit para remover esse import tambem.",
    "- Se remover uma variavel, remova declaracao e todos os usos.",
    "- Se remover um item de um objeto/array, ajuste virgulas se necessario.",
    "- Cada edit deve deixar o codigo sintaticamente valido e sem imports/variaveis nao usadas.",
    "",
    "Formato de saida OBRIGATORIO (JSON puro, sem fences):",
    "{",
    '  "description": "Descricao curta da mudanca (max 200 chars)",',
    '  "risk": <numero 1-5>,',
    '  "rollback": "Instrucao de rollback simples",',
    '  "files": [',
    "    {",
    '      "path": "caminho/relativo/arquivo.ts",',
    '      "action": "modify",',
    '      "edits": [',
    '        { "search": "trecho exato do original", "replace": "trecho com a mudanca" }',
    "      ]",
    "    },",
    "    {",
    '      "path": "caminho/relativo/novo-arquivo.ts",',
    '      "action": "create",',
    '      "content": "conteudo completo do novo arquivo"',
    "    }",
    "  ]",
    "}",
  ].join("\n");
}

export interface ExecutionPromptContext {
  readonly delegation: KairosDelegation;
  readonly plan: ForgePlan;
  readonly contextFiles: readonly FileContext[];
  readonly fileTree: string;
  readonly allowedDirs: readonly string[];
  readonly aliasInfo?: string;
  readonly preExistingErrors?: string;
  readonly nexusContextSection?: string;
  readonly goalSection?: string;
}

export function buildExecutionUserPrompt(promptCtx: ExecutionPromptContext): string {
  const {
    delegation, plan, contextFiles, fileTree, allowedDirs,
    aliasInfo = "", preExistingErrors = "",
    nexusContextSection = "", goalSection = "",
  } = promptCtx;
  const contextBlocks = contextFiles.map(
    (f) => `--- ${f.path} ---\n${f.content}\n--- end ---`,
  );

  const contextSection = contextBlocks.length > 0
    ? ["", "CODIGO REAL DO PROJETO:", ...contextBlocks, ""].join("\n")
    : "";

  const aliasSection = aliasInfo.length > 0 ? `\n${aliasInfo}\n` : "";

  const preExistingSection = preExistingErrors.length > 0
    ? [
        "",
        "ERROS PRE-EXISTENTES (NAO CORRIGIR):",
        "Os erros abaixo ja existiam antes da sua alteracao. NAO tente corrigi-los.",
        "Seu objetivo e apenas completar a tarefa sem introduzir NOVOS erros.",
        preExistingErrors,
        "",
      ].join("\n")
    : "";

  const goalLine = goalSection.length > 0 ? goalSection : "";
  const nexusLine = nexusContextSection.length > 0 ? nexusContextSection : "";

  return [
    `Tarefa: ${delegation.task}`,
    `Resultado esperado: ${delegation.expected_output}`,
    `Goal ID: ${delegation.goal_id}`,
    goalLine,
    `Data: ${new Date().toISOString()}`,
    "",
    nexusLine,
    `PLANO DE EXECUCAO:`,
    `- Abordagem: ${plan.approach}`,
    `- Arquivos a modificar: ${plan.filesToModify.join(", ")}`,
    `- Arquivos a criar: ${plan.filesToCreate.join(", ") || "nenhum"}`,
    plan.dependencies.length > 0
      ? `- Dependencias: ${plan.dependencies.join("; ")}`
      : "",
    "",
    "ESTRUTURA DO PROJETO:",
    fileTree.slice(0, 3000),
    "",
    `Diretorios permitidos: ${allowedDirs.join(", ")}`,
    aliasSection,
    contextSection,
    preExistingSection,
    "REGRAS OBRIGATORIAS:",
    "1. Responda APENAS com JSON puro, sem markdown, sem explicacoes.",
    "2. ANTES DE GERAR EDITS: verifique se a mudanca JA FOI FEITA no codigo mostrado.",
    "   Se a tarefa ja esta implementada, retorne files VAZIO: { \"description\": \"...\", \"risk\": 1, \"files\": [], \"rollback\": \"N/A - already done\" }",
    "3. Modifique APENAS arquivos cujo conteudo foi mostrado acima em 'CODIGO REAL DO PROJETO'.",
    "4. NAO modifique arquivos que nao aparecem no contexto acima.",
    '5. Para action "modify": o campo "search" DEVE ser copiado LETRA POR LETRA do codigo mostrado.',
    "   NAO invente, NAO suponha, NAO reconstrua de memoria. COPIE do contexto.",
    "6. Inclua 2-3 linhas antes e depois da mudanca no search para contexto unico.",
    '7. O campo "replace" deve ter as mesmas linhas de contexto, mas com a mudanca aplicada.',
    '8. Para action "create": use "content" com o arquivo completo.',
    '9. Cada arquivo com action "modify" DEVE ter pelo menos um edit com search e replace.',
    "10. Foque APENAS na mudanca minima necessaria. Nao faca mudancas extras.",
    "11. Se um arquivo NAO precisa ser alterado para cumprir a tarefa, NAO o inclua.",
    aliasInfo.length > 0
      ? "12. Use os import aliases do projeto ao inves de caminhos relativos longos."
      : "",
    preExistingErrors.length > 0
      ? "13. IGNORE erros pre-existentes listados acima. Corrija apenas erros que VOCE introduzir."
      : "",
  ].join("\n");
}

export function buildReplanningUserPrompt(
  delegation: KairosDelegation,
  fileTree: string,
  allowedDirs: readonly string[],
  failedPlan: ForgePlan,
  failureReason: string,
  failedFileSnippets: readonly { readonly path: string; readonly snippet: string }[],
  indexPromptSection: string = "",
): string {
  const hasIndex = indexPromptSection.length > 0;

  const lines = [
    `Tarefa: ${delegation.task}`,
    `Resultado esperado: ${delegation.expected_output}`,
    `Goal ID: ${delegation.goal_id}`,
    "",
    "=== REPLANNING: PLANO ANTERIOR FALHOU ===",
    "",
    "Seu plano ANTERIOR falhou completamente. Voce DEVE escolher arquivos DIFERENTES.",
    "",
    "PLANO QUE FALHOU:",
    `- Abordagem: ${failedPlan.approach}`,
    `- Arquivos que tentou modificar: ${failedPlan.filesToModify.join(", ")}`,
    `- Motivo da falha: ${failureReason}`,
    "",
  ];

  if (failedFileSnippets.length > 0) {
    lines.push("CONTEUDO REAL DOS ARQUIVOS QUE FALHARAM (primeiras 40 linhas):");
    for (const snippet of failedFileSnippets) {
      lines.push(`--- ${snippet.path} ---`, snippet.snippet, "--- end ---", "");
    }
    lines.push(
      "Como voce pode ver, estes arquivos NAO contem o codigo que voce esperava.",
      "Voce DEVE escolher arquivos COMPLETAMENTE DIFERENTES para a tarefa.",
      "",
    );
  }

  lines.push(
    "REGRAS DE REPLANNING:",
    "1. NAO escolha os mesmos arquivos que falharam.",
    "2. Analise CUIDADOSAMENTE a arvore de arquivos e o indice de exports.",
    "3. Procure arquivos cujo NOME ou EXPORTS tenham relacao direta com a tarefa.",
    "4. Se a tarefa e sobre 'theme/dark/cores', busque arquivos com 'theme', 'color', 'palette', 'token' no nome.",
    "5. NAO confunda configs de infraestrutura (logger, database, cache) com configs de UI/tema.",
    "",
  );

  if (hasIndex) {
    lines.push(
      "INDICE DE ARQUIVOS (exports por arquivo):",
      indexPromptSection,
      "",
      "Use este indice para identificar EXATAMENTE quais arquivos contem o codigo relevante.",
      "",
    );
  }

  lines.push(
    "ESTRUTURA DO PROJETO:",
    fileTree.slice(0, hasIndex ? 2000 : 4000),
    "",
    `Diretorios permitidos para escrita: ${allowedDirs.join(", ")}`,
    "",
    "=== FIM DO CONTEXTO DE REPLANNING ===",
    "",
    "Responda APENAS com JSON puro no formato obrigatorio de planejamento.",
  );

  return lines.join("\n");
}

export interface CorrectionPromptContext {
  readonly delegation: KairosDelegation;
  readonly plan: ForgePlan;
  readonly errorOutput: string;
  readonly currentFilesState: readonly { readonly path: string; readonly content: string }[];
  readonly fileTree: string;
  readonly allowedDirs: readonly string[];
  readonly appliedFiles?: readonly string[];
  readonly failedFile?: string;
  readonly failedEditIndex?: number;
  readonly attempts?: readonly CorrectionAttempt[];
  readonly typeDefinitions?: string;
  readonly escalationSnippets?: string;
  readonly isWorkspaceRestored?: boolean;
}

function buildFailedEditLine(file: string, editIdx: number | undefined): string {
  const suffix = editIdx === undefined ? "" : ` (edit index ${editIdx})`;
  return `EDIT QUE FALHOU: arquivo "${file}"${suffix}`;
}

function buildContextSection(
  currentFilesState: readonly { readonly path: string; readonly content: string }[],
  isWorkspaceRestored: boolean,
): string {
  const stateLabel = isWorkspaceRestored ? "ORIGINAL" : "ESTADO ATUAL";
  const contextBlocks = currentFilesState.map(
    (f) => `--- ${f.path} (${stateLabel}) ---\n${f.content}\n--- end ---`,
  );

  const contextHeader = isWorkspaceRestored
    ? "ESTADO ORIGINAL DOS ARQUIVOS (workspace RESTAURADO - edits anteriores NAO foram aplicados):"
    : "ESTADO ATUAL DOS ARQUIVOS (apos edits anteriores):";

  return contextBlocks.length > 0
    ? ["", contextHeader, ...contextBlocks, ""].join("\n")
    : "";
}

function appendOptionalSections(lines: string[], promptCtx: CorrectionPromptContext): void {
  const { appliedFiles, failedFile, failedEditIndex, attempts, typeDefinitions, escalationSnippets } = promptCtx;

  if (appliedFiles && appliedFiles.length > 0) {
    lines.push(
      "",
      "EDITS JA APLICADOS COM SUCESSO:",
      ...appliedFiles.map((f) => `  - ${f}`),
      "NAO re-edite estes arquivos a menos que necessario para corrigir erros de validacao.",
    );
  }

  if (failedFile !== undefined) {
    lines.push(
      "",
      buildFailedEditLine(failedFile, failedEditIndex),
      "Corrija APENAS este edit. Releia o ESTADO ATUAL do arquivo acima e copie EXATAMENTE.",
    );
  }

  if (attempts && attempts.length > 0) {
    lines.push(
      "",
      "HISTORICO DE TENTATIVAS ANTERIORES:",
      ...attempts.map((a) => `  Round ${a.round}: [${a.errorType}] ${a.errorSummary}`),
      "ATENCAO: NAO repita os mesmos erros. Analise o que falhou e mude a estrategia.",
    );
  }

  if (typeDefinitions && typeDefinitions.length > 0) {
    lines.push("", "DEFINICOES DE TIPOS RELEVANTES AOS ERROS:", typeDefinitions);
  }

  if (escalationSnippets && escalationSnippets.length > 0) {
    lines.push("", "CONTEXTO ADICIONAL DE ESCALACAO (arquivos com erros):", escalationSnippets);
  }
}

function buildCorrectionInstructions(isWorkspaceRestored: boolean): readonly string[] {
  const stateRef = isWorkspaceRestored ? "ESTADO ORIGINAL" : "ESTADO ATUAL";

  return [
    "INSTRUCOES DE CORRECAO:",
    `1. Os arquivos acima mostram o ${stateRef} REAL dos arquivos no disco.`,
    `2. O campo 'search' DEVE ser uma copia EXATA de linhas que existem no ${stateRef} acima.`,
    "3. Se o erro for 'Search string not found':",
    "   - Sua string de busca NAO existe no arquivo.",
    `   - Releia o ${stateRef} do arquivo e copie LETRA POR LETRA as linhas que quer substituir.`,
    "   - Alternativa: use 'line' e 'endLine' para edits baseados em numero de linha.",
    "   - Se o arquivo NAO precisa ser alterado, REMOVA-O da lista de files.",
    "4. NAO invente ou suponha conteudo. Copie LITERALMENTE do conteudo mostrado acima.",
    "5. Inclua 2-3 linhas de contexto antes e depois para garantir unicidade.",
    "6. NAO repita edits que ja foram aplicados com sucesso.",
    "7. Corrija APENAS os erros indicados, nao faca mudancas extras.",
    "8. Se um arquivo NAO contribui para resolver a tarefa, REMOVA-O da resposta.",
    "9. Se o erro for um import nao utilizado, remova-o.",
    "10. Responda APENAS com JSON puro no formato obrigatorio.",
  ];
}

export function buildCorrectionUserPrompt(promptCtx: CorrectionPromptContext): string {
  const { delegation, plan, errorOutput, currentFilesState, fileTree, allowedDirs, isWorkspaceRestored } = promptCtx;
  const restored = isWorkspaceRestored === true;

  const contextSection = buildContextSection(currentFilesState, restored);
  const truncatedErrors = errorOutput.slice(0, MAX_LINT_ERROR_CHARS);

  const lines = [
    `Tarefa: ${delegation.task}`,
    `Resultado esperado: ${delegation.expected_output}`,
    `Goal ID: ${delegation.goal_id}`,
    "",
    `PLANO ORIGINAL:`,
    `- Abordagem: ${plan.approach}`,
    "",
    "ESTRUTURA DO PROJETO:",
    fileTree.slice(0, 2000),
    "",
    `Diretorios permitidos: ${allowedDirs.join(", ")}`,
  ];

  appendOptionalSections(lines, promptCtx);

  if (restored) {
    lines.push(
      "",
      "=== AVISO IMPORTANTE: WORKSPACE RESTAURADO ===",
      "O workspace foi RESTAURADO ao estado ORIGINAL.",
      "Seus edits anteriores NAO foram aplicados ou foram revertidos.",
      "O ESTADO mostrado acima reflete o arquivo ORIGINAL, NAO o resultado das suas tentativas anteriores.",
      "Voce DEVE gerar TODOS os edits necessarios desde o estado original.",
      "NAO assuma que qualquer mudanca sua foi preservada.",
      "=== FIM DO AVISO ===",
    );
  }

  lines.push(
    contextSection,
    "ERRO DA TENTATIVA ANTERIOR:",
    truncatedErrors,
    "",
    ...buildCorrectionInstructions(restored),
  );

  return lines.join("\n");
}
