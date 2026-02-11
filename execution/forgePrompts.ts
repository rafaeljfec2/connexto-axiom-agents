import type { KairosDelegation } from "../orchestration/types.js";
import type { FileContext } from "./fileDiscovery.js";
import type { ForgePlan } from "./forgeTypes.js";
import { MAX_LINT_ERROR_CHARS } from "./forgeTypes.js";

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
  ].join("\n");
}

export function buildPlanningUserPrompt(
  delegation: KairosDelegation,
  fileTree: string,
  allowedDirs: readonly string[],
): string {
  return [
    `Tarefa: ${delegation.task}`,
    `Resultado esperado: ${delegation.expected_output}`,
    `Goal ID: ${delegation.goal_id}`,
    "",
    "ESTRUTURA DO PROJETO:",
    fileTree.slice(0, 4000),
    "",
    `Diretorios permitidos para escrita: ${allowedDirs.join(", ")}`,
    "",
    "Analise a tarefa e a estrutura do projeto.",
    "Identifique quais arquivos voce precisa LER para entender o contexto,",
    "e quais arquivos precisa MODIFICAR ou CRIAR.",
    "Responda APENAS com JSON puro.",
  ].join("\n");
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

export function buildExecutionUserPrompt(
  delegation: KairosDelegation,
  plan: ForgePlan,
  contextFiles: readonly FileContext[],
  fileTree: string,
  allowedDirs: readonly string[],
): string {
  const contextBlocks = contextFiles.map(
    (f) => `--- ${f.path} ---\n${f.content}\n--- end ---`,
  );

  const contextSection = contextBlocks.length > 0
    ? ["", "CODIGO REAL DO PROJETO:", ...contextBlocks, ""].join("\n")
    : "";

  return [
    `Tarefa: ${delegation.task}`,
    `Resultado esperado: ${delegation.expected_output}`,
    `Goal ID: ${delegation.goal_id}`,
    `Data: ${new Date().toISOString()}`,
    "",
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
    contextSection,
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
  ].join("\n");
}

export function buildCorrectionUserPrompt(
  delegation: KairosDelegation,
  plan: ForgePlan,
  errorOutput: string,
  currentFilesState: readonly { readonly path: string; readonly content: string }[],
  fileTree: string,
  allowedDirs: readonly string[],
): string {
  const contextBlocks = currentFilesState.map(
    (f) => `--- ${f.path} (ESTADO ATUAL) ---\n${f.content}\n--- end ---`,
  );

  const contextSection = contextBlocks.length > 0
    ? ["", "ESTADO ATUAL DOS ARQUIVOS (apos edits anteriores):", ...contextBlocks, ""].join("\n")
    : "";

  const truncatedErrors = errorOutput.slice(0, MAX_LINT_ERROR_CHARS);

  return [
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
    contextSection,
    "ERRO DA TENTATIVA ANTERIOR:",
    truncatedErrors,
    "",
    "INSTRUCOES DE CORRECAO:",
    "1. Os arquivos acima mostram o ESTADO ATUAL REAL dos arquivos no disco.",
    "2. O campo 'search' DEVE ser uma copia EXATA de linhas que existem no ESTADO ATUAL acima.",
    "3. Se o erro for 'Search string not found':",
    "   - Sua string de busca NAO existe no arquivo.",
    "   - Releia o ESTADO ATUAL do arquivo e copie LETRA POR LETRA as linhas que quer substituir.",
    "   - Se o arquivo NAO precisa ser alterado, REMOVA-O da lista de files.",
    "4. NAO invente ou suponha conteudo. Copie LITERALMENTE do ESTADO ATUAL mostrado.",
    "5. Inclua 2-3 linhas de contexto antes e depois para garantir unicidade.",
    "6. NAO repita edits que ja foram aplicados com sucesso.",
    "7. Corrija APENAS os erros indicados, nao faca mudancas extras.",
    "8. Se um arquivo NAO contribui para resolver a tarefa, REMOVA-O da resposta.",
    "9. Se o erro for um import nao utilizado, remova-o.",
    "10. Responda APENAS com JSON puro no formato obrigatorio.",
  ].join("\n");
}
