function normalizeAccents(text: string): string {
  return text.normalize("NFD").replaceAll(/[\u0300-\u036f]/g, "");
}

export function extractKeywords(task: string): readonly string[] {
  const stopWords = new Set([
    "a", "o", "de", "do", "da", "em", "no", "na", "para", "por", "com",
    "que", "um", "uma", "os", "as", "dos", "das", "se", "ou", "e", "ao",
    "the", "is", "are", "and", "or", "to", "from", "in", "of", "for", "with",
    "eu", "quero", "ser", "nao", "faz", "sentido", "opcao",
    "implementar", "criar", "remover", "adicionar", "modificar", "alterar",
  ]);

  return normalizeAccents(task)
    .toLowerCase()
    .replaceAll(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w))
    .slice(0, 10);
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
