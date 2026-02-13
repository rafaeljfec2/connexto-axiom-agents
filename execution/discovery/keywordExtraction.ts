function normalizeAccents(text: string): string {
  return text.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");
}

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a", "o", "de", "do", "da", "em", "no", "na", "para", "por", "com",
  "que", "um", "uma", "os", "as", "dos", "das", "se", "ou", "ao",
  "the", "is", "are", "and", "or", "to", "from", "in", "of", "for", "with",
  "quero", "ser", "nao", "faz", "sentido", "opcao",
  "implementar", "criar", "remover", "adicionar", "modificar", "alterar",
  "preparar", "apenas", "rodar", "minimo", "minima", "antes", "subir", "depois",
  "sobre", "como", "cada", "todo", "todos", "toda", "todas",
  "precisa", "deve", "fazer", "ainda", "tambem", "quando", "onde",
  "esta", "esse", "essa", "este", "estes", "essas", "esses",
  "entre", "apos", "ate", "sem", "mais", "menos", "muito", "muita",
  "usar", "utilizar", "incluir", "excluir", "manter", "atualizar",
  "garantir", "verificar", "testar", "aplicar", "executar", "corrigir",
  "ajustar", "configurar", "definir", "revisar", "validar",
  "novo", "nova", "novos", "novas", "atual", "antigo",
  "primeiro", "segundo", "ultimo", "proximo",
  "teste", "testes", "tests", "lint", "build", "push", "pull", "merge", "commit",
  "registrar", "conforme", "mudanca", "mudancas", "mapeamento",
  "evidencias", "evidencia", "necessario", "necessaria",
  "according", "change", "changes", "minimum", "mapping",
  "ensure", "check", "update", "run", "make", "that", "this",
]);

const STOP_VERB_STEMS: ReadonlySet<string> = new Set([
  "implement", "cri", "remov", "adicion", "modific", "alter",
  "prepar", "rod", "sub", "faz", "us", "utiliz", "inclu",
  "exclu", "mant", "atualiz", "garant", "verific", "test",
  "aplic", "execut", "corrig", "ajust", "configur", "defin",
  "revis", "valid", "registr", "mape",
]);

function isStopWordByStem(word: string): boolean {
  if (word.endsWith("ando") || word.endsWith("endo") || word.endsWith("indo")) {
    const stem = word.slice(0, -4);
    if (stem.length >= 2 && STOP_VERB_STEMS.has(stem)) return true;
  }

  if (word.endsWith("ado") || word.endsWith("ido") || word.endsWith("ados") || word.endsWith("idos")) {
    const stem = word.endsWith("s") ? word.slice(0, -4) : word.slice(0, -3);
    if (stem.length >= 2 && STOP_VERB_STEMS.has(stem)) return true;
  }

  return false;
}

const MIN_KEYWORD_LENGTH = 4;

export function extractKeywords(task: string): readonly string[] {
  const words = normalizeAccents(task)
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= MIN_KEYWORD_LENGTH && !STOP_WORDS.has(w) && !isStopWordByStem(w));

  return [...new Set(words)].slice(0, 10);
}

export function extractKeywordsFromMultipleSources(
  sources: readonly string[],
): readonly string[] {
  const combined = sources.filter((s) => s.length > 0).join(" ");
  return extractKeywords(combined);
}

export function extractGlobPatterns(keywords: readonly string[]): readonly string[] {
  const patterns: string[] = [];

  for (const keyword of keywords) {
    if (keyword.length < 3) continue;
    patterns.push(`**/*${keyword}*.*`);

    const capitalized = keyword.charAt(0).toUpperCase() + keyword.slice(1);
    if (capitalized !== keyword) {
      patterns.push(`**/*${capitalized}*.*`);
    }
  }

  return patterns;
}
