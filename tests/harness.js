// Carrega o <script> de index.html (ou gerador-escala-ank.html) num vm do Node com DOM falso,
// para testar motor, regras e folha sem navegador. Sem dependências.
const fs = require('fs'), path = require('path'), vm = require('vm');

function appFile() {
  const root = path.join(__dirname, '..');
  for (const f of ['index.html', 'gerador-escala-ank.html']) if (fs.existsSync(path.join(root, f))) return path.join(root, f);
  throw new Error('index.html não encontrado');
}

// Proxy que aceita qualquer acesso/chamada (document, window etc.) sem quebrar o carregamento.
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : stub()),
  apply: () => stub(), set: () => true,
});

// Devolve o contexto do app com estado novo (padrão do app) ou o estado passado.
function loadApp(state) {
  const html = fs.readFileSync(appFile(), 'utf8');
  let code = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  code = code.replace(/\ninit\(\);\s*$/, '\n') +
    '\nthis.__get=()=>STATE; this.__set=s=>{STATE=normalizeState(s);};';
  const store = {};
  const sb = {
    console, Date, Math, JSON, Object, Array, String, Number, Set, Map, Promise,
    setTimeout: () => 0, clearTimeout: () => 0, document: stub(), navigator: stub(),
    matchMedia: () => ({ matches: false, addEventListener() {} }),
    fetch: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = String(v); }, removeItem: (k) => { delete store[k]; } },
    IntersectionObserver: function () { return { observe() {} }; }, requestAnimationFrame: () => 0,
    Blob: function () {}, File: function () {}, CustomEvent: function () {},
  };
  sb.window = new Proxy(sb, { get: (t, k) => (k in t ? t[k] : stub()) });
  vm.createContext(sb);
  vm.runInContext(code, sb);
  sb.__set(state === undefined ? null : state);
  return sb;
}

// Estado de teste: equipe/regras padrão do app, sem dias, com taxas fictícias para a folha.
function freshState(app, extra = {}) {
  const s = JSON.parse(JSON.stringify(app.__get()));
  s.days = {}; s.constraints = []; s.diaristaPool = ['D1', 'D2', 'D3'];
  s.team.forEach((e) => { if (e.employmentType !== 'mensalista') e.hourlyRate = 10; });
  return Object.assign(s, extra);
}

module.exports = { loadApp, freshState };
