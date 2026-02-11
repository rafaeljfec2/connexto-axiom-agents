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
    "  Inclua arquivos de rotas, config, componentes vizinhos, tipos, etc.",
    "- files_to_modify: Apenas os arquivos que serao alterados.",
    "- files_to_create: Apenas arquivos novos que precisam ser criados.",
    "- Escolha paths REAIS baseados na arvore de arquivos fornecida.",
    "- NAO invente paths que nao existem na arvore.",
    "- estimated_risk: 1 (trivial) a 5 (alto impacto).",
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
    "IMPORTANTE: Responda APENAS com JSON puro, sem markdown, sem explicacoes.",
    "Baseie suas mudancas no codigo REAL mostrado acima.",
    'Para arquivos existentes (action "modify"), use "edits" com blocos search/replace.',
    'O campo "search" DEVE ser copiado LETRA POR LETRA do codigo mostrado acima.',
    "Inclua 2-3 linhas antes e depois da mudanca no search para contexto unico.",
    'O campo "replace" deve ter as mesmas linhas de contexto, mas com a mudanca aplicada.',
    'Para novos arquivos (action "create"), use "content" com o arquivo completo.',
    "Siga o plano de execucao. Gere o JSON com as mudancas de codigo necessarias.",
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
    "- Os arquivos acima mostram o ESTADO ATUAL REAL dos arquivos no disco.",
    "- O campo 'search' DEVE ser uma copia EXATA de linhas que existem no ESTADO ATUAL acima.",
    "- Se o erro for 'Search string not found', sua string de busca NAO existe no arquivo.",
    "  Releia o ESTADO ATUAL do arquivo acima e copie as linhas EXATAS que quer substituir.",
    "- NAO invente ou suponha conteudo. Copie LITERALMENTE do ESTADO ATUAL mostrado.",
    "- Inclua 2-3 linhas de contexto antes e depois para garantir unicidade.",
    "- NAO repita edits que ja foram aplicados com sucesso.",
    "- Corrija APENAS os erros indicados, nao faca mudancas extras.",
    "- Se o erro for um import nao utilizado, remova-o.",
    "- Se o erro for de sintaxe (parsing error), corrija a estrutura do codigo.",
    "- Responda APENAS com JSON puro no formato obrigatorio.",
  ].join("\n");
}
