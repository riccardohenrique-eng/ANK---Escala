# ANK---Escala
Escala ANK - Cruz das Almas

## Testes

Sem dependências — usam o próprio Node (`node:test`) e carregam o `index.html` num sandbox:

```
node --test tests/*.test.js
```

- `tests/motor.test.js` — geração da escala (2 folgas/semana, condições, caixa, férias, edições manuais, dias confirmados)
- `tests/regras.test.js` — livro de regras (caixa, cobertura, condições, 7 dias, 11h, domingos)
- `tests/folha.test.js` — folha (horas normais/extras, teto de 44h, DSR por semana, dobro de domingo, mensalista)
- `tests/api.test.js` — chave de acesso das APIs

Rodam no GitHub Actions a cada push (`.github/workflows/testes.yml`).
