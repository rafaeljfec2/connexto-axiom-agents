# Golden Example: Technical Research

## Task Input

```
Pesquise alternativas para cache em memoria no Node.js para o sistema connexto-axiom
```

## Expected Output

```
OPCOES:
- Opcao A: node-cache — biblioteca simples de cache in-memory com TTL
- Opcao B: lru-cache — cache com politica LRU e limites de tamanho
- Opcao C: Map nativo com wrapper de TTL manual

PROS / CONTRAS:
- A: +simples de configurar, +suporte a TTL nativo, -sem politica de eviction, -dependencia extra
- B: +controle de memoria via max size, +politica LRU, +amplamente adotado, -API um pouco mais complexa
- C: +zero dependencias, +performance maxima, -requer implementacao manual de TTL e eviction

RISCO:
- A: baixo
- B: baixo
- C: medio (manutencao do wrapper, edge cases de memory leaks)

RECOMENDACAO:
- lru-cache e a opcao mais equilibrada para o stack atual (Node.js + TypeScript), com controle de memoria e sem complexidade excessiva
```

## What NOT to do

- Do NOT suggest implementation code
- Do NOT make the final decision
- Do NOT include more than 5 options
- Do NOT include personal opinions
