
"use strict";

/* ---------- configuração do e-mail de acompanhamento de SPI ----------
   Ajuste os valores abaixo conforme necessário — nenhum outro trecho do
   arquivo precisa ser tocado para mudar cópias (CC) ou links. */

// Endereços que sempre entram em cópia (CC), independente da empresa do projeto.
var EMAIL_CC_ALWAYS = ['mcagnim@avalonhomes.com.br', 'planejamento@avalonhomes.com.br'];

// Endereço adicional de CC, de acordo com a empresa do projeto (d.company).
var EMAIL_CC_BY_COMPANY = {
  'JKA': 'lmauler@jkaconstructioninc.com',
  'Prestige': 'mramos@prestigeconstructiongrp.com'
};

// Link do painel de acompanhamento de SPI (site de produção) de cada empresa,
// incluído discretamente no fim do corpo do e-mail.
var COMPANY_SPI_PANEL = {
  'JKA': 'https://spi-supabase-1.vercel.app/jka',
  'Prestige': 'https://spi-supabase-1.vercel.app/prestige'
};

/* ---------- login ----------
   Edite a lista abaixo para definir quem pode entrar no painel: um objeto
   { name, password } por pessoa. ATENÇÃO: como este é um arquivo HTML aberto
   direto no navegador, esse nome e senha ficam visíveis para quem abrir o
   código-fonte do arquivo — isso funciona como uma tela de acesso simples
   para afastar quem não deveria estar olhando, não como segurança de verdade
   (não use senhas que você usa em outros lugares). */
// JKA e Prestige acessam pelo link com "?empresa=JKA" / "?empresa=Prestige" —
// sem senha, sem tela de login, somente leitura (companyScope restringe os
// dados, role 'viewer' esconde toda a edição). Só Wesley Jacob usa a tela de
// login com senha; as demais entradas seguem no array só pelo companyScope.
var AUTH_USERS = [
  { name: 'Wesley Jacob', password: 'wj@123', role: 'admin', companyScope: null },
  { name: 'JKA Construction Inc.', password: null, role: 'viewer', companyScope: 'JKA' },
  { name: 'Prestige Construction Group', password: null, role: 'viewer', companyScope: 'Prestige' }
];
var AUTH_SESSION_KEY = 'spi-auth-user';
var authOverrides = {}; // { nome: novaSenha } — senhas trocadas pela tela "Alterar senha", sobrepõem AUTH_USERS
var SPI_FORCED_VIEW = (typeof window.SPI_FORCED_VIEW !== 'undefined' && window.SPI_FORCED_VIEW) || null; // "JKA"/"Prestige" nos sites dedicados de cada empresa (definido antes de app.js); null no site do Wesley Jacob
var currentUser = null;
var currentUserRole = 'admin';
var currentUserCompanyScope = null;
function isAdminUser(){ return currentUserRole === 'admin'; }

// A troca de senha (só usada por Wesley Jacob) fica dentro do mesmo "estado"
// publicado que os lançamentos — ver persistState()/buildPublishHtml() mais
// abaixo, perto de persistData().
async function loadAuthOverrides(){
  if (!supabaseClient){ authOverrides = {}; return; }
  try {
    var res = await supabaseClient.from('app_state').select('auth_overrides').eq('id', 'global').maybeSingle();
    authOverrides = (res.data && res.data.auth_overrides && typeof res.data.auth_overrides === 'object') ? res.data.auth_overrides : {};
  } catch (e) {
    authOverrides = {};
  }
}
async function persistAuthOverrides(){
  return await persistState();
}
function passwordFor(name){
  if (Object.prototype.hasOwnProperty.call(authOverrides, name)) return authOverrides[name];
  var u = AUTH_USERS.find(function(u){ return u.name === name; });
  return u ? u.password : undefined;
}

function tryRestoreSession(){
  try {
    var saved = sessionStorage.getItem(AUTH_SESSION_KEY);
    if (saved && AUTH_USERS.some(function(u){ return u.name === saved; })) return saved;
  } catch (e) { /* sessionStorage indisponível — pede login sempre */ }
  return null;
}
function persistSession(name){
  try { sessionStorage.setItem(AUTH_SESSION_KEY, name); } catch (e) { /* login vale só para esta visualização */ }
}
function clearSession(){
  try { sessionStorage.removeItem(AUTH_SESSION_KEY); } catch (e) { /* nada a limpar */ }
}
function populateLoginUsers(){
  var sel = document.getElementById('loginUser');
  if (!sel) return;
  sel.innerHTML = '';
  // a tela de login só serve para o acesso com senha (Wesley Jacob); JKA e
  // Prestige entram direto pelo link com "?empresa=", sem aparecer aqui.
  AUTH_USERS.filter(function(u){ return u.role === 'admin'; }).forEach(function(u){
    var opt = document.createElement('option'); opt.value = u.name; opt.textContent = u.name;
    sel.appendChild(opt);
  });
}
function applyRolePermissions(){
  var admin = isAdminUser();
  var toHideForViewer = ['adminToolbarTop', 'headerAuthRow', 'btnAdvanceWeek', 'btnDeleteWeek', 'tableHeadActions', 'thActions'];
  toHideForViewer.forEach(function(id){
    var elm = document.getElementById(id);
    if (elm) elm.hidden = !admin;
  });
  var label = document.getElementById('id-block-label');
  if (label) label.textContent = admin ? 'lançamento direto' : 'somente leitura';

  // identificação da empresa, visível só nos painéis somente leitura (JKA /
  // Prestige); no login do Wesley Jacob o campo empresa continua abreviado
  // (coluna EMPRESA da tabela, pills etc.) — nada muda ali.
  var companyLine = document.getElementById('id-company-line');
  var companyNameEl = document.getElementById('id-company-name');
  if (companyLine && companyNameEl){
    if (currentUserCompanyScope){
      var scopedUser = AUTH_USERS.find(function(u){ return u.companyScope === currentUserCompanyScope; });
      companyNameEl.textContent = (scopedUser && scopedUser.name) || currentUserCompanyScope;
      companyLine.hidden = false;
    } else {
      companyLine.hidden = true;
    }
  }

  var companyGroup = document.getElementById('companyFilterGroup');
  if (companyGroup) companyGroup.hidden = !!currentUserCompanyScope;

  // nos sites de cada empresa (visão presa a uma única empresa) o card "SPI
  // por empresa" fica redundante — a empresa já aparece nos cards acima —
  // então some ele e deixa o card de faixa ocupar a linha toda.
  var companyBreakdownCard = document.getElementById('companyBreakdownCard');
  if (companyBreakdownCard) companyBreakdownCard.hidden = !!currentUserCompanyScope;
  var breakdownGrid = document.querySelector('.breakdown-grid');
  if (breakdownGrid) breakdownGrid.classList.toggle('single-col', !!currentUserCompanyScope);
}
function showDashboard(name){
  currentUser = name;
  var userRec = AUTH_USERS.find(function(u){ return u.name === name; });
  currentUserRole = (userRec && userRec.role) || 'admin';
  currentUserCompanyScope = (userRec && userRec.companyScope) || null;
  var loginScreen = document.getElementById('loginScreen');
  var wrap = document.getElementById('dashWrap');
  if (loginScreen) loginScreen.hidden = true;
  if (wrap) wrap.hidden = false;
  var who = document.getElementById('loggedInAs');
  if (who) who.textContent = 'Logado como ' + name;
  applyRolePermissions();
  boot();
}
function logout(){
  clearSession();
  location.reload();
}
async function initLogin(){
  await loadAuthOverrides();

  populateLoginUsers();
  var btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', logout);
  initChangePasswordModal();

  // acesso das empresas: cada empresa tem seu próprio site publicado, com
  // SPI_FORCED_VIEW já fixado pela própria página (ex.: "JKA"), então entra direto nessa
  // visão, somente leitura, sem pedir login e sem depender de parâmetro de
  // URL (links publicados costumam rodar dentro de um iframe da própria
  // claude.ai, que nem sempre repassa a query string do link para a página).
  if (SPI_FORCED_VIEW){
    var forcedUser = AUTH_USERS.find(function(u){
      return u.companyScope && u.companyScope.toLowerCase() === SPI_FORCED_VIEW.toLowerCase();
    });
    if (forcedUser){ showDashboard(forcedUser.name); return; }
  }

  // mantido como reforço/compatibilidade: link com "?empresa=JKA" ou
  // "?empresa=Prestige" também entra direto, quando a query string chega
  // até a página (acesso direto ao HTML, fora do iframe da claude.ai).
  var viewParam = getViewParam();
  if (viewParam){
    var viewUser = AUTH_USERS.find(function(u){
      return u.companyScope && u.companyScope.toLowerCase() === viewParam.toLowerCase();
    });
    if (viewUser){ showDashboard(viewUser.name); return; }
  }

  var restored = tryRestoreSession();
  if (restored){ showDashboard(restored); return; }

  var form = document.getElementById('loginForm');
  var errEl = document.getElementById('loginError');
  if (form) form.addEventListener('submit', function(e){
    e.preventDefault();
    var name = document.getElementById('loginUser').value;
    var pass = document.getElementById('loginPassword').value;
    var expected = passwordFor(name);
    if (expected === undefined || pass !== expected){
      errEl.textContent = 'Nome ou senha incorretos.';
      errEl.classList.add('show');
      document.getElementById('loginPassword').value = '';
      document.getElementById('loginPassword').focus();
      return;
    }
    errEl.classList.remove('show');
    persistSession(name);
    showDashboard(name);
  });
}

/* ---------- alterar a própria senha ---------- */
function openChangePasswordModal(){
  var f = document.getElementById('passwordForm'); if (f) f.reset();
  var err = document.getElementById('passwordError'); if (err){ err.textContent = ''; err.classList.remove('show'); }
  var who = document.getElementById('passwordForUser'); if (who) who.textContent = currentUser || '';
  var o = document.getElementById('passwordOverlay'); if (o) o.hidden = false;
  var first = document.getElementById('pwCurrent'); if (first) first.focus();
}
function closeChangePasswordModal(){
  var o = document.getElementById('passwordOverlay'); if (o) o.hidden = true;
}
function initChangePasswordModal(){
  var btn = document.getElementById('btnChangePassword');
  if (btn) btn.addEventListener('click', openChangePasswordModal);
  var closeBtn = document.getElementById('passwordClose');
  if (closeBtn) closeBtn.addEventListener('click', closeChangePasswordModal);
  var cancelBtn = document.getElementById('pwCancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeChangePasswordModal);
  var overlay = document.getElementById('passwordOverlay');
  if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) closeChangePasswordModal(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && overlay && !overlay.hidden) closeChangePasswordModal(); });

  var form = document.getElementById('passwordForm');
  if (form) form.addEventListener('submit', async function(e){
    e.preventDefault();
    var errEl = document.getElementById('passwordError');
    var cur = document.getElementById('pwCurrent').value;
    var next = document.getElementById('pwNew').value;
    var confirmPw = document.getElementById('pwConfirm').value;

    if (cur !== passwordFor(currentUser)){
      errEl.textContent = 'Senha atual incorreta.';
      errEl.classList.add('show');
      return;
    }
    if (!next || next.length < 4){
      errEl.textContent = 'A nova senha precisa ter pelo menos 4 caracteres.';
      errEl.classList.add('show');
      return;
    }
    if (next !== confirmPw){
      errEl.textContent = 'A confirmação não confere com a nova senha.';
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');
    authOverrides[currentUser] = next;
    await persistAuthOverrides();
    closeChangePasswordModal();
    showToast('Senha de ' + currentUser + ' atualizada.', '');
  });
}

var SVGNS = 'http://www.w3.org/2000/svg';
var DATA = [];
var companies = [];
var scopes = [];
var weeks = [];
var excludedProjects = new Set();

var STATUS_COLOR = { good: 'var(--status-good)', warn: 'var(--status-warning-mark)', crit: 'var(--status-critical)' };

var state = {
  week: null,
  companies: new Set(),
  scopes: new Set(),
  sortKey: 'spi',
  sortDir: 'asc',
  isolatedProject: null,
  trendMode: false, // quando true, o gráfico principal mostra o histórico de SPI por semana do isolatedProject, em vez da dispersão
  companyStatusFilter: { good: true, warn: true, crit: true }, // quais status aparecem na grade de histórico
  companyGridView: false // true = grade com uma mini-linha de SPI ao longo do tempo por projeto (da seleção atual de Empresa/Escopo)
};

var editingKey = null;
var editingRow = null;

/* ---------- derived lists (recomputed whenever DATA changes) ---------- */
function recomputeDerivedLists(){
  var prevCompanies = companies;
  var prevScopes = scopes;
  companies = Array.from(new Set(DATA.map(function(d){ return d.company; }))).sort();
  scopes = Array.from(new Set(DATA.map(function(d){ return d.scope; }))).sort();
  weeks = Array.from(new Set(DATA.map(function(d){ return d.week; }))).sort();
  // só adiciona ao filtro ativo as empresas/escopos que passaram a existir agora
  // (novos, vindos de um lançamento recém-criado/editado) — assim uma seleção de
  // filtro já feita pelo usuário (ex.: uma única empresa) sobrevive a edições,
  // exclusões, avanço de semana etc., em vez de ser resetada para "Todas".
  companies.forEach(function(c){ if (prevCompanies.indexOf(c) === -1) state.companies.add(c); });
  scopes.forEach(function(s){ if (prevScopes.indexOf(s) === -1) state.scopes.add(s); });
  if (!state.week || weeks.indexOf(state.week) === -1){
    state.week = weeks.length ? weeks[weeks.length - 1] : null;
  }
}

function refreshFilterUI(){
  var cc = document.getElementById('companyPills');
  var sc = document.getElementById('scopePills');
  if (cc) buildPills(cc, companies, state.companies, null);
  if (sc) buildPills(sc, scopes, state.scopes, null);
  populateWeekOptions();
  populateDatalists();
}

/* ---------- small helpers ---------- */
function pad2(n){ return n < 10 ? '0' + n : '' + n; }
function round4(n){ return Math.round(n * 10000) / 10000; }
function fmtSpi(v){ return (typeof v === 'number' ? v : 0).toFixed(3).replace('.', ','); }
function fmtPct(v){ return Math.round((v || 0) * 100) + '%'; }
function statusOf(spi){ if (spi > 1) return 'good'; if (spi >= 0.85) return 'warn'; return 'crit'; }
var statusLabel = { good: 'Bom', warn: 'Atenção', crit: 'Crítico' };
var statusRange = { good: '> 1,00', warn: '0,85–1,00', crit: '< 0,85' };

/* ---------- PM e-mail / nome (per project) ---------- */
function pmEmailForProject(project){
  var matches = DATA.filter(function(d){ return d.project === project && d.pm_email; });
  if (!matches.length) return '';
  matches.sort(function(a, b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return matches[0].pm_email;
}
function pmNameForProject(project){
  var matches = DATA.filter(function(d){ return d.project === project && d.pm_name; });
  if (!matches.length) return '';
  matches.sort(function(a, b){ return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return matches[0].pm_name;
}

/* ---------- status-update e-mail generation (mirrors the e-mail templates doc) ---------- */
function emailFmtSpi(v){ return (typeof v === 'number' ? v : 0).toFixed(2).replace('.', ','); }
function emailFmtDate(iso){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return m[3] + '/' + m[2] + '/' + m[1];
}
function emailFmtDias(v){ return Math.round(Math.abs(v || 0)); }

function buildEmailSubject(d){
  var st = statusOf(d.spi);
  var tag = st === 'crit' ? 'Crítico' : st === 'warn' ? 'Atenção' : 'Bom';
  var tail = st === 'crit' ? ' — Ação necessária' : st === 'warn' ? ' — Acompanhamento de schedule' : '';
  return d.id + ' — ' + d.project + ' | ' + d.scope + tail + ' - SPI ' + tag;
}

function buildEmailQuestions(d){
  var qs = [];
  if (d.pct_complete <= 0.90){
    qs.push('Quais ações podem ser realizadas para recuperar esse indicador?');
  }
  qs.push('Há alguma responsabilidade do GC associada a esse resultado que podemos desconsiderar no schedule do projeto?');
  return qs.map(function(q, i){ return (i + 1) + '. ' + q; });
}

function buildEmailBody(d){
  var st = statusOf(d.spi);
  var spiStr = emailFmtSpi(d.spi);
  var pctStr = fmtPct(d.pct_complete);
  var dataStr = emailFmtDate(d.date);
  var dias = emailFmtDias(d.finish_variance);
  var paras = [];

  var pmName = pmNameForProject(d.project);
  paras.push(pmName ? ('Prezado(a) ' + pmName + ',') : 'Prezado(a) Gerente de Contrato,');
  paras.push(
    'Este e-mail tem como objetivo informar a situação atual do indicador de SPI (Schedule Performance Index) do projeto ' +
    d.id + ' — ' + d.project + ' | ' + d.scope + ', sob execução da ' + d.company + '.'
  );
  paras.push(
    'O SPI (Schedule Performance Index) é o indicador que mede a eficiência do uso do tempo no projeto, comparando a ' +
    'duração planejada (baseline) com a duração real necessária para entregar o que já foi executado. Um SPI de 1,00 ' +
    'significa que o projeto está exatamente dentro do prazo planejado; valores abaixo de 1,00 indicam atraso em relação ' +
    'ao planejado, e valores acima de 1,00 indicam adiantamento.'
  );
  paras.push(
    'As faixas de classificação utilizadas são: Crítico (SPI abaixo de 0,85), Atenção (SPI entre 0,85 e 1,00) e Bom ' +
    '(SPI igual ou maior que 1,00).'
  );

  // SPI exatamente igual a 1,00 (mesmo caindo tecnicamente na faixa de
  // ATENÇÃO, já que "Bom" exige SPI > 1,00) não deve gerar as perguntas de
  // confirmação/variação — não há atraso real a questionar.
  var isExactlyOne = spiStr === '1,00';

  if (st === 'crit'){
    paras.push(
      'Na atualização de ' + dataStr + ', o projeto está com ' + pctStr + ' de execução física e SPI de ' + spiStr +
      ', valor abaixo de 0,85 e, portanto, classificado na faixa CRÍTICA de desempenho de schedule. Isso representa um ' +
      'atraso estimado de aproximadamente ' + dias + ' dias em relação ao prazo base.'
    );
    paras.push('Diante desse cenário, solicitamos retorno sobre os pontos abaixo:');
    paras.push(buildEmailQuestions(d).join('\n'));
    paras.push('Pedimos retorno o quanto antes para que possamos alinhar, em conjunto, um plano de recuperação de schedule para este projeto.');
  } else if (st === 'warn' && !isExactlyOne){
    paras.push(
      'Na atualização de ' + dataStr + ', o projeto está com ' + pctStr + ' de execução física e SPI de ' + spiStr +
      ', valor dentro da faixa de ATENÇÃO (entre 0,85 e 1,00). Isso indica um atraso de aproximadamente ' + dias +
      ' dias em relação ao prazo base, que merece acompanhamento para não evoluir para uma situação crítica.'
    );
    paras.push('Para isso, solicitamos retorno sobre os pontos abaixo:');
    paras.push(buildEmailQuestions(d).join('\n'));
    paras.push('Ficamos à disposição para alinhar o que for necessário.');
  } else if (st === 'warn' && isExactlyOne){
    // SPI = 1,00: informativo, sem perguntas de confirmação/variação.
    paras.push(
      'Na atualização de ' + dataStr + ', o projeto está com ' + pctStr + ' de execução física e SPI de ' + spiStr +
      ', exatamente na meta de schedule (SPI = 1,00).'
    );
    paras.push('Reforçamos a importância de manter o projeto na meta de SPI (≥ 1,00) até a sua conclusão, garantindo a aderência ao schedule planejado.');
  } else {
    var extra = '';
    if (d.finish_variance < -0.5){
      extra = ' O projeto está, inclusive, à frente do prazo base em aproximadamente ' + dias + ' dias.';
    }
    paras.push(
      'Na atualização de ' + dataStr + ', o projeto está com ' + pctStr + ' de execução física e SPI de ' + spiStr +
      ', dentro (ou acima) da meta de schedule (SPI ≥ 1,00).' + extra
    );
    paras.push('Reforçamos a importância de manter o projeto acima da meta de SPI (≥ 1,00) até a sua conclusão, garantindo a aderência ao schedule planejado.');
  }

  var panelUrl = COMPANY_SPI_PANEL[d.company];
  if (panelUrl){
    paras.push('(Painel de acompanhamento de SPI: ' + panelUrl + ')');
  }

  return paras.join('\n\n');
}

// Monta a lista de CC: sempre os dois endereços fixos, mais o endereço
// específico da empresa do projeto (JKA ou Prestige), sem duplicar.
function ccListForCompany(company){
  var list = EMAIL_CC_ALWAYS.slice();
  var extra = EMAIL_CC_BY_COMPANY[company];
  if (extra && list.indexOf(extra) === -1) list.push(extra);
  return list;
}

function openMailClient(d){
  var to = pmEmailForProject(d.project) || '';
  var cc = ccListForCompany(d.company).join(',');
  var subject = buildEmailSubject(d);
  var body = buildEmailBody(d);
  var url = 'mailto:' + to + '?cc=' + encodeURIComponent(cc) +
    '&subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body);
  var a = document.createElement('a');
  a.href = url;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

/* ---------- imagem do histórico de SPI para colar no e-mail ----------
   O link mailto: só aceita corpo em texto puro — não existe forma de embutir
   uma imagem diretamente no corpo do e-mail por esse caminho, em nenhum
   cliente de e-mail. Por isso, em vez de baixar um arquivo (como era feito
   antes), a imagem do histórico de SPI do projeto é copiada para a área de
   transferência assim que o usuário confirma o envio, para colar (Ctrl+V) no
   corpo do e-mail antes da assinatura. A imagem é sempre o histórico do
   projeto do e-mail (independente do que estiver visível no <svg id="chart">
   da tela no momento), construída à parte para não depender do modo de
   visualização atual. */
function readCssVar(name, fallback){
  try {
    var v = getComputedStyle(document.documentElement).getPropertyValue(name);
    return (v && v.trim()) ? v.trim() : fallback;
  } catch (e){ return fallback; }
}
function buildEmailChartSvg(project){
  var trendRows = projectTrendRows(project);
  var svgNS = 'http://www.w3.org/2000/svg';
  var pad = 24, headerH = 78;
  var totalW = W + pad * 2;
  var totalH = H + headerH + pad * 2;
  var fontFamily = 'system-ui, -apple-system, "Segoe UI", sans-serif';

  // cores resolvidas do tema atual (claro/escuro) — precisam ser valores
  // finais (não var(--x)) porque a imagem é servida via blob de um SVG
  // isolado, fora da cascata de CSS da página.
  var c = {
    bg: readCssVar('--surface-1', '#fcfcfb'),
    border: readCssVar('--border', 'rgba(11,11,11,0.10)'),
    textPrimary: readCssVar('--text-primary', '#0b0b0b'),
    textSecondary: readCssVar('--text-secondary', '#52514e'),
    textMuted: readCssVar('--text-muted', '#898781'),
    hairline: readCssVar('--hairline', '#e1e0d9'),
    baseline: readCssVar('--baseline', '#c3c2b7'),
    good: readCssVar('--status-good', '#0ca30c'),
    warnMark: readCssVar('--status-warning-mark', '#fab219'),
    crit: readCssVar('--status-critical', '#d03b3b'),
    goodWash: readCssVar('--status-good-wash', 'rgba(12,163,12,0.08)'),
    warnWash: readCssVar('--status-warning-wash', 'rgba(250,178,25,0.16)'),
    critWash: readCssVar('--status-critical-wash', 'rgba(208,59,59,0.07)')
  };

  var svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('xmlns', svgNS);
  svg.setAttribute('width', totalW);
  svg.setAttribute('height', totalH);
  svg.setAttribute('viewBox', '0 0 ' + totalW + ' ' + totalH);

  function node(tag, attrs, parent){
    var e = document.createElementNS(svgNS, tag);
    for (var k in attrs){ e.setAttribute(k, attrs[k]); }
    (parent || svg).appendChild(e);
    return e;
  }

  node('rect', { x: 0, y: 0, width: totalW, height: totalH, fill: c.bg });
  node('rect', { x: 0.5, y: 0.5, width: totalW - 1, height: totalH - 1, fill: 'none', stroke: c.border });

  var title = node('text', { x: pad, y: pad + 16, 'font-family': fontFamily, 'font-size': 18, 'font-weight': 700, fill: c.textPrimary });
  title.textContent = 'Histórico de SPI — ' + project;

  var note = node('text', { x: pad, y: pad + 34, 'font-family': fontFamily, 'font-size': 12, fill: c.textMuted });
  note.textContent = 'SPI de "' + project + '" em cada semana com avanço registrado (' + trendRows.length + ' semana(s)).';

  // legenda (mesmos textos/cores do painel)
  var legendItems = [
    { label: 'Bom — SPI > 1,00', color: c.good },
    { label: 'Atenção — SPI 0,85 a 1,00', color: c.warnMark },
    { label: 'Crítico — SPI < 0,85', color: c.crit }
  ];
  var lx = pad, ly = pad + 56;
  legendItems.forEach(function(it){
    node('circle', { cx: lx + 5, cy: ly - 4, r: 5, fill: it.color });
    var t = node('text', { x: lx + 15, y: ly, 'font-family': fontFamily, 'font-size': 12, 'font-weight': 500, fill: c.textSecondary });
    t.textContent = it.label;
    lx += 22 + it.label.length * 6.3;
  });
  node('line', { x1: lx, x2: lx + 20, y1: ly - 4, y2: ly - 4, stroke: c.textMuted, 'stroke-width': 2, 'stroke-dasharray': '3 4' });
  var dtxt = node('text', { x: lx + 28, y: ly, 'font-family': fontFamily, 'font-size': 12, 'font-weight': 500, fill: c.textSecondary });
  dtxt.textContent = 'Faixas de SPI (1,00 / 0,85)';

  // gráfico propriamente dito, deslocado abaixo do cabeçalho/legenda — mesma
  // geometria (W/H/M/xScale/yScale/trendXScale) do histórico exibido no painel.
  var g = node('g', { transform: 'translate(' + pad + ',' + headerH + ')' });

  node('rect', { x: M.left, y: yScale(yMax), width: plotW, height: yScale(1) - yScale(yMax), fill: c.goodWash }, g);
  node('rect', { x: M.left, y: yScale(1), width: plotW, height: yScale(0.85) - yScale(1), fill: c.warnWash }, g);
  node('rect', { x: M.left, y: yScale(0.85), width: plotW, height: yScale(yMin) - yScale(0.85), fill: c.critWash }, g);

  for (var yv = yMin; yv <= yMax + 0.0001; yv += 0.1){
    var gy = yScale(yv);
    node('line', { x1: M.left, x2: M.left + plotW, y1: gy, y2: gy, stroke: c.hairline, 'stroke-width': 1 }, g);
    var t2 = node('text', { x: M.left - 10, y: gy + 3.5, 'text-anchor': 'end', 'font-family': fontFamily, 'font-size': 9, fill: c.textMuted }, g);
    t2.textContent = yv.toFixed(2);
  }

  var xLabelStep = trendRows.length > 1 ? Math.max(1, Math.ceil(26 / (plotW / (trendRows.length - 1)))) : 1;
  trendRows.forEach(function(d, i){
    if (i % xLabelStep !== 0 && i !== trendRows.length - 1) return;
    var x = trendXScale(i, trendRows.length);
    var y = M.top + plotH + 16;
    var xt = node('text', { x: x, y: y, 'text-anchor': 'end', 'font-family': fontFamily, 'font-size': 9, fill: c.textMuted,
      transform: 'rotate(-40 ' + x + ' ' + y + ')' }, g);
    xt.textContent = fmtDateMDY(d.date);
  });

  node('line', { x1: M.left, x2: M.left + plotW, y1: M.top + plotH, y2: M.top + plotH, stroke: c.baseline, 'stroke-width': 1 }, g);
  node('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + plotH, stroke: c.baseline, 'stroke-width': 1 }, g);

  var ty = yScale(1);
  node('line', { x1: M.left, x2: M.left + plotW, y1: ty, y2: ty, stroke: c.textMuted, 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, g);
  var lbl = node('text', { x: M.left + plotW, y: ty - 6, 'text-anchor': 'end', 'font-family': fontFamily, 'font-size': 9, 'font-weight': 500, fill: c.textSecondary }, g);
  lbl.textContent = 'Meta / limite bom (SPI = 1,00)';

  var ty2 = yScale(0.85);
  node('line', { x1: M.left, x2: M.left + plotW, y1: ty2, y2: ty2, stroke: c.textMuted, 'stroke-width': 1.5, 'stroke-dasharray': '3 4' }, g);
  var lbl2 = node('text', { x: M.left + plotW, y: ty2 - 6, 'text-anchor': 'end', 'font-family': fontFamily, 'font-size': 9, 'font-weight': 500, fill: c.textSecondary }, g);
  lbl2.textContent = 'Limite atenção / crítico (0,85)';

  var xt2 = node('text', { x: M.left + plotW / 2, y: H - 6, 'text-anchor': 'middle', 'font-family': fontFamily, 'font-size': 10, fill: c.textMuted }, g);
  xt2.textContent = 'Data de referência';
  var yt2 = node('text', { x: -(M.top + plotH / 2), y: 16, 'text-anchor': 'middle', 'font-family': fontFamily, 'font-size': 10, fill: c.textMuted,
    transform: 'rotate(-90)' }, g);
  yt2.textContent = 'SPI (índice de desempenho de prazo)';

  if (trendRows.length){
    var pointsStr = trendRows.map(function(d, i){
      return trendXScale(i, trendRows.length) + ',' + yScale(Math.min(Math.max(d.spi, yMin), yMax));
    }).join(' ');
    node('polyline', { points: pointsStr, fill: 'none', stroke: c.textSecondary, 'stroke-width': 2, opacity: 0.55 }, g);

    trendRows.forEach(function(d, i){
      var cx = trendXScale(i, trendRows.length);
      var cy = yScale(Math.min(Math.max(d.spi, yMin), yMax));
      var st = statusOf(d.spi);
      var color = st === 'good' ? c.good : st === 'warn' ? c.warnMark : c.crit;
      node('circle', { cx: cx, cy: cy, r: 5, fill: color, stroke: c.bg, 'stroke-width': 2 }, g);
      var vt = node('text', { x: cx, y: cy - 12, 'text-anchor': 'middle', 'font-family': fontFamily, 'font-size': 9, 'font-weight': 600, fill: c.textSecondary }, g);
      vt.textContent = fmtSpi(d.spi);
    });
  }

  return { svg: svg, width: totalW, height: totalH };
}

function svgElementToPngBlob(svgEl, width, height, scale){
  return new Promise(function(resolve, reject){
    try {
      var svgString = new XMLSerializer().serializeToString(svgEl);
      var svgBlob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
      var url = URL.createObjectURL(svgBlob);
      var img = new Image();
      img.onload = function(){
        var s = scale || 2; // renderiza em 2x para colar com boa nitidez
        var canvas = document.createElement('canvas');
        canvas.width = Math.round(width * s);
        canvas.height = Math.round(height * s);
        var ctx = canvas.getContext('2d');
        ctx.scale(s, s);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        canvas.toBlob(function(blob){
          if (blob) resolve(blob); else reject(new Error('Falha ao gerar PNG do gráfico.'));
        }, 'image/png');
      };
      img.onerror = function(){ URL.revokeObjectURL(url); reject(new Error('Falha ao carregar o SVG do gráfico.')); };
      img.src = url;
    } catch (e){ reject(e); }
  });
}

// Gera o PNG do histórico de SPI do projeto e copia para a área de
// transferência. Resolve para true se a cópia deu certo, false caso o
// navegador não suporte (ou algo falhe) — nesse caso o e-mail ainda é aberto
// normalmente, só sem a cópia automática.
function copyProjectChartToClipboard(project){
  if (!navigator.clipboard || typeof window.ClipboardItem !== 'function'){
    return Promise.resolve(false);
  }
  try {
    var built = buildEmailChartSvg(project);
    return svgElementToPngBlob(built.svg, built.width, built.height, 2)
      .then(function(blob){
        return navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
      })
      .then(function(){ return true; })
      .catch(function(err){
        console.warn('Não foi possível copiar o gráfico de SPI para a área de transferência:', err);
        return false;
      });
  } catch (e){
    console.warn('Não foi possível gerar o gráfico de SPI para o e-mail:', e);
    return Promise.resolve(false);
  }
}

var pendingEmailRow = null;
function openEmailConfirm(d){
  pendingEmailRow = d;
  var to = pmEmailForProject(d.project);
  var text = 'Deseja gerar o e-mail de acompanhamento de SPI para ' + projectLabel(d) + '?';
  text += to ? (' Ele será enviado para ' + to + '.') : ' Nenhum e-mail de PM cadastrado para este projeto — o campo "Para" ficará em branco.';
  text += ' Em cópia: ' + ccListForCompany(d.company).join(', ') + '.';
  text += ' O gráfico de histórico de SPI do projeto será copiado para a área de transferência, para você colar (Ctrl+V) no corpo do e-mail antes da assinatura.';
  var textEl = document.getElementById('emailConfirmText');
  if (textEl) textEl.textContent = text;
  var overlay = document.getElementById('emailConfirmOverlay');
  if (overlay) overlay.hidden = false;
}
function closeEmailConfirm(){
  var overlay = document.getElementById('emailConfirmOverlay');
  if (overlay) overlay.hidden = true;
  pendingEmailRow = null;
}
function initEmailConfirm(){
  var overlay = document.getElementById('emailConfirmOverlay');
  if (!overlay) return;
  var noBtn = document.getElementById('emailConfirmNo');
  var yesBtn = document.getElementById('emailConfirmYes');
  if (noBtn) noBtn.addEventListener('click', closeEmailConfirm);
  if (yesBtn) yesBtn.addEventListener('click', function(){
    if (pendingEmailRow){
      var row = pendingEmailRow;
      copyProjectChartToClipboard(row.project).then(function(copied){
        openMailClient(row);
        showToast(
          copied
            ? 'Gráfico de SPI copiado — cole (Ctrl+V) no e-mail antes da assinatura.'
            : 'E-mail gerado, mas não foi possível copiar o gráfico automaticamente (navegador sem suporte). Cole ou anexe manualmente, se precisar.',
          copied ? undefined : 'warn'
        );
      });
    }
    closeEmailConfirm();
  });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeEmailConfirm(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !overlay.hidden) closeEmailConfirm(); });
}

function weekLabelFromInputValue(v){
  var m = /^(\d{4})-W(\d{2})$/.exec(v || '');
  if (!m) return null;
  return m[1] + '-' + m[2];
}
function inputValueFromWeekLabel(label){
  if (!label) return '';
  var parts = label.split('-');
  return parts[0] + '-W' + parts[1];
}
function fmtDateMDY(iso){
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return iso || '';
  return m[2] + '/' + m[3] + '/' + m[1];
}
function dateFromWeekLabel(label){
  var m = /^(\d{4})-(\d{2})$/.exec(label || '');
  if (!m) return '';
  var year = +m[1], week = +m[2];
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var jan4Day = (jan4.getUTCDay() + 6) % 7;
  var monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + (week - 1) * 7);
  var saturday = new Date(monday);
  saturday.setUTCDate(monday.getUTCDate() + 5);
  return saturday.toISOString().slice(0, 10);
}
function mondayOfWeekLabel(label){
  var m = /^(\d{4})-(\d{2})$/.exec(label || '');
  if (!m) return null;
  var year = +m[1], week = +m[2];
  var jan4 = new Date(Date.UTC(year, 0, 4));
  var jan4Day = (jan4.getUTCDay() + 6) % 7;
  var monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - jan4Day + (week - 1) * 7);
  return monday;
}
function weekLabelFromMonday(mondayDate){
  var year = mondayDate.getUTCFullYear();
  var candidates = [year + 1, year, year - 1];
  for (var i = 0; i < candidates.length; i++){
    var y = candidates[i];
    var m1 = mondayOfWeekLabel(y + '-01');
    var diffWeeks = Math.round((mondayDate - m1) / (7 * 24 * 3600 * 1000));
    if (diffWeeks >= 0 && diffWeeks <= 53) return y + '-' + pad2(diffWeeks + 1);
  }
  return year + '-01';
}
function nextWeekLabel(label){
  var monday = mondayOfWeekLabel(label);
  if (!monday) return null;
  var nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);
  return weekLabelFromMonday(nextMonday);
}
function bandOf(pct){ return pct <= 0.45 ? '0-45%' : (pct <= 0.90 ? '45-90%' : '90%+'); }
function projectLabel(d){ return d.id ? (d.id + ' — ' + d.project) : d.project; }
function newRowKey(){
  return (window.crypto && crypto.randomUUID) ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : ('row' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
}

/* ---------- weekly rollover ("Avançar semana") ---------- */
// clique no botão só valida e pergunta, informando o número da próxima
// semana; a cópia de fato só acontece se a pessoa confirmar.
function advanceWeek(){
  if (!state.week) return;
  var rows = DATA.filter(function(d){ return d.week === state.week; });
  if (!rows.length){ showToast('Não há projetos na semana atual para avançar.', 'warn'); return; }
  var nextLabel = nextWeekLabel(state.week);
  if (!nextLabel){ showToast('Não foi possível calcular a próxima semana.', 'error'); return; }
  openAdvanceConfirm(nextLabel, rows.length);
}
async function performAdvanceWeek(){
  var btn = document.getElementById('btnAdvanceWeek');
  if (!state.week) return;
  var rows = DATA.filter(function(d){ return d.week === state.week; });
  if (!rows.length) return;
  var nextLabel = nextWeekLabel(state.week);
  if (!nextLabel) return;
  var nextDate = dateFromWeekLabel(nextLabel);
  var existingNext = new Set(DATA.filter(function(d){ return d.week === nextLabel; })
    .map(function(d){ return d.company + '||' + d.project; }));

  var added = [];
  rows.forEach(function(d){
    var key = d.company + '||' + d.project;
    if (existingNext.has(key)) return;
    var row = {
      rowKey: newRowKey(), id: d.id, company: d.company, project: d.project, scope: d.scope,
      cr: 0, baseline_duration: d.baseline_duration, finish_variance: d.finish_variance,
      schedule_duration: d.schedule_duration, spi: d.spi,
      week: nextLabel, date: nextDate,
      pct_complete: d.pct_complete, band: d.band
    };
    if (d.pm_email) row.pm_email = d.pm_email;
    if (d.pm_name) row.pm_name = d.pm_name;
    added.push(row);
  });

  if (!added.length){
    state.week = nextLabel;
    recomputeDerivedLists();
    refreshFilterUI();
    render();
    showToast('A semana ' + nextLabel + ' já tinha todos esses projetos lançados.', '');
    return;
  }

  if (btn) btn.disabled = true;
  var ok = await persistData(DATA.concat(added));
  if (btn) btn.disabled = false;
  if (!ok) return;

  state.week = nextLabel;
  recomputeDerivedLists();
  refreshFilterUI();
  render();
  showToast(added.length + ' projeto(s) copiados para a semana ' + nextLabel + '. Ajuste % concluído, variação de prazo e solicitações de mudança em cada um.', '');
}

function openAdvanceConfirm(nextLabel, count){
  var textEl = document.getElementById('advanceConfirmText');
  if (textEl) textEl.textContent = 'Isso copia ' + count + ' projeto(s) da semana ' + state.week + ' para a semana ' + nextLabel + '. Deseja avançar para a semana ' + nextLabel + '?';
  var overlay = document.getElementById('advanceConfirmOverlay');
  if (overlay) overlay.hidden = false;
}
function closeAdvanceConfirm(){
  var overlay = document.getElementById('advanceConfirmOverlay');
  if (overlay) overlay.hidden = true;
}
function initAdvanceConfirm(){
  var overlay = document.getElementById('advanceConfirmOverlay');
  if (!overlay) return;
  var noBtn = document.getElementById('advanceConfirmNo');
  var yesBtn = document.getElementById('advanceConfirmYes');
  if (noBtn) noBtn.addEventListener('click', closeAdvanceConfirm);
  if (yesBtn) yesBtn.addEventListener('click', function(){
    closeAdvanceConfirm();
    performAdvanceWeek();
  });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeAdvanceConfirm(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !overlay.hidden) closeAdvanceConfirm(); });
}

/* ---------- excluir todos os lançamentos de uma semana (ex: semana incluída por engano) ---------- */
function btnDeleteWeekClick(){
  if (!state.week) return;
  var rows = DATA.filter(function(d){ return d.week === state.week; });
  if (!rows.length){ showToast('Não há lançamentos nesta semana para excluir.', 'warn'); return; }
  openDeleteWeekConfirm(state.week, rows.length);
}
async function deleteWeek(weekLabel){
  var rows = DATA.filter(function(d){ return d.week === weekLabel; });
  if (!rows.length) return;
  var btn = document.getElementById('btnDeleteWeek');
  if (btn) btn.disabled = true;
  var newData = DATA.filter(function(d){ return d.week !== weekLabel; });
  var ok = await persistData(newData);
  if (btn) btn.disabled = false;
  if (!ok) return;

  recomputeDerivedLists();
  refreshFilterUI();
  render();
  showToast(rows.length + ' lançamento(s) da semana ' + weekLabel + ' excluído(s).', '');
}
function openDeleteWeekConfirm(weekLabel, count){
  var textEl = document.getElementById('deleteWeekConfirmText');
  if (textEl) textEl.textContent = 'Isso apaga permanentemente ' + count + ' lançamento(s) da semana ' + weekLabel + '. Essa ação não pode ser desfeita — use isso quando a semana foi incluída por engano.';
  var overlay = document.getElementById('deleteWeekConfirmOverlay');
  if (overlay) overlay.hidden = false;
}
function closeDeleteWeekConfirm(){
  var overlay = document.getElementById('deleteWeekConfirmOverlay');
  if (overlay) overlay.hidden = true;
}
function initDeleteWeekConfirm(){
  var overlay = document.getElementById('deleteWeekConfirmOverlay');
  if (!overlay) return;
  var noBtn = document.getElementById('deleteWeekConfirmNo');
  var yesBtn = document.getElementById('deleteWeekConfirmYes');
  if (noBtn) noBtn.addEventListener('click', closeDeleteWeekConfirm);
  if (yesBtn) yesBtn.addEventListener('click', function(){
    var w = state.week;
    closeDeleteWeekConfirm();
    if (w) deleteWeek(w);
  });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeDeleteWeekConfirm(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !overlay.hidden) closeDeleteWeekConfirm(); });
}
/* ---------- persistence (Supabase) ----------
   O banco de dados no Supabase é o registro dos dados: os lançamentos ficam
   na tabela spi_records, e os projetos excluídos + a senha alterada ficam
   numa linha única da tabela app_state (id = 'global'). Qualquer alteração
   passa por persistState(), que grava as duas tabelas. */
function showToast(message, kind){
  var stack = document.getElementById('toastStack');
  if (!stack) return;
  var t = document.createElement('div');
  t.className = 'toast' + (kind ? ' ' + kind : '');
  var dot = document.createElement('span'); dot.className = 't-dot';
  var span = document.createElement('span'); span.textContent = message;
  t.appendChild(dot); t.appendChild(span);
  stack.appendChild(t);
  setTimeout(function(){ t.remove(); }, 4200);
}

// ---------- Supabase: cliente e camada de dados ----------
// Configurado em config.js (SUPABASE_URL / SUPABASE_ANON_KEY). Sem essas
// chaves preenchidas, o painel funciona só nesta visualização (nada é salvo).
var supabaseClient = (function(){
  try {
    if (window.SUPABASE_URL && window.SUPABASE_ANON_KEY &&
        window.SUPABASE_URL.indexOf('COLE_AQUI') === -1 &&
        window.SUPABASE_ANON_KEY.indexOf('COLE_AQUI') === -1 &&
        window.supabase && typeof window.supabase.createClient === 'function'){
      return window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
    }
  } catch (e) { /* segue sem Supabase configurado */ }
  return null;
})();

// Lê "?empresa=JKA" / "?empresa=Prestige" da URL — mantido como reforço,
// já que cada site (jka.html/prestige.html) fixa SPI_FORCED_VIEW direto.
function getViewParam(){
  try {
    var params = new URLSearchParams(window.location.search);
    return params.get('empresa');
  } catch (e) {
    return null;
  }
}

function recordToRow(d){
  return {
    row_key: d.rowKey, id: d.id, company: d.company, project: d.project, scope: d.scope,
    cr: d.cr, baseline_duration: d.baseline_duration, finish_variance: d.finish_variance,
    schedule_duration: d.schedule_duration, spi: d.spi, week: d.week, date: d.date,
    pct_complete: d.pct_complete, band: d.band,
    // pm_email/pm_name precisam ser preservados aqui — sem isso, todo save()
    // (persistState apaga e reinsere a tabela inteira) perdia esses dois campos.
    pm_email: d.pm_email || null, pm_name: d.pm_name || null
  };
}
function rowToRecord(r){
  return {
    rowKey: r.row_key, id: r.id, company: r.company, project: r.project, scope: r.scope,
    cr: r.cr, baseline_duration: r.baseline_duration, finish_variance: r.finish_variance,
    schedule_duration: r.schedule_duration, spi: r.spi, week: r.week, date: r.date,
    pct_complete: r.pct_complete, band: r.band,
    pm_email: r.pm_email || null, pm_name: r.pm_name || null
  };
}

// Ponto único de gravação: todo lançamento adicionado/editado/excluído, toda
// exclusão de projeto e toda troca de senha passam por aqui. Substitui a
// tabela spi_records inteira pelo estado atual em memória (mesma lógica do
// painel original, só que gravando no Supabase em vez de republicar o
// próprio HTML) e atualiza a linha única de app_state.
async function persistState(){
  if (!supabaseClient){
    showToast('Supabase não configurado (config.js) — alteração aplicada só nesta visualização.', 'warn');
    return true;
  }
  try {
    var delRes = await supabaseClient.from('spi_records').delete().not('row_key', 'is', null);
    if (delRes.error) throw delRes.error;
    var rows = DATA.map(recordToRow);
    for (var i = 0; i < rows.length; i += 500){
      var insRes = await supabaseClient.from('spi_records').insert(rows.slice(i, i + 500));
      if (insRes.error) throw insRes.error;
    }
    var stateRes = await supabaseClient.from('app_state').update({
      excluded_projects: Array.from(excludedProjects),
      auth_overrides: authOverrides,
      updated_at: new Date().toISOString()
    }).eq('id', 'global');
    if (stateRes.error) throw stateRes.error;
    return true;
  } catch (err) {
    showToast('Não foi possível salvar no Supabase agora. Tente novamente em instantes.', 'error');
    return false;
  }
}

async function loadData(){
  if (!supabaseClient){ DATA = []; return; }
  try {
    var res = await supabaseClient.from('spi_records').select('*').order('date', { ascending: true });
    if (res.error) throw res.error;
    DATA = (res.data || []).map(rowToRecord);
  } catch (e) {
    showToast('Não foi possível carregar os dados do Supabase.', 'error');
    DATA = [];
  }
}

// Updates the in-memory dataset whenever a lançamento is added, edited,
// deleted, or a week is advanced, and saves it to Supabase.
async function persistData(newData){
  DATA = newData;
  return await persistState();
}

/* ---------- export / import (for use as a downloaded, standalone file) ---------- */
// Quando o painel está aberto pelo link publicado (dentro do visualizador da
// Claude), um download disparado pela própria página não funciona sozinho —
// é preciso pedir através da capacidade "downloads", que mostra uma
// confirmação para quem está vendo a página. Fora desse visualizador (o
// arquivo .html baixado e aberto direto no navegador) window.claude nem
// existe, e o download tradicional funciona normalmente.
async function exportData(){
  var payload = { data: DATA, excludedProjects: Array.from(excludedProjects) };
  var jsonStr = JSON.stringify(payload, null, 2);
  var filename = 'spi-lancamentos.json';

  if (window.claude && typeof window.claude.use === 'function'){
    var downloads = null;
    try { downloads = await window.claude.use('downloads'); } catch (e) { downloads = null; }
    if (downloads && typeof downloads.save === 'function'){
      try {
        await downloads.save({ filename: filename, data: jsonStr });
        showToast('Arquivo exportado. Use "Importar dados" na próxima vez que abrir o painel para continuar de onde parou.', '');
      } catch (err) {
        if (!err || err.code !== 'declined'){
          showToast('Não foi possível exportar o arquivo agora. Tente novamente em instantes.', 'error');
        }
      }
      return;
    }
  }

  var blob = new Blob([jsonStr], { type: 'application/json' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  showToast('Arquivo exportado. Use "Importar dados" na próxima vez que abrir o painel para continuar de onde parou.', '');
}

function importDataFromFile(file){
  var reader = new FileReader();
  reader.onload = async function(e){
    var parsed, newData, newExcluded = null;
    try {
      parsed = JSON.parse(e.target.result);
      if (Array.isArray(parsed)){
        // formato antigo: só a lista de lançamentos, sem exclusões
        newData = parsed;
      } else if (parsed && Array.isArray(parsed.data)){
        newData = parsed.data;
        if (Array.isArray(parsed.excludedProjects)) newExcluded = parsed.excludedProjects;
      } else {
        throw new Error('formato inválido');
      }
    } catch (err){
      showToast('Não foi possível importar: o arquivo não é um export válido deste painel.', 'error');
      return;
    }
    DATA = newData;
    if (newExcluded) excludedProjects = new Set(newExcluded);
    recomputeDerivedLists();
    refreshFilterUI();
    updateExcludedButtonLabel();
    render();
    await persistState();
    var msg = 'Dados importados: ' + newData.length + ' lançamento(s)';
    if (newExcluded) msg += ', ' + newExcluded.length + ' exclusão(ões)';
    showToast(msg + '.', '');
  };
  reader.onerror = function(){ showToast('Não foi possível ler o arquivo selecionado.', 'error'); };
  reader.readAsText(file, 'utf-8');
}

/* ---------- filter pills ---------- */
function updatePillStyle(btn, value, pressed, colorFor){
  if (pressed && value && colorFor) {
    var c = colorFor(value);
    btn.style.borderColor = c;
    btn.style.color = c;
  } else if (pressed && !value) {
    btn.style.borderColor = 'var(--text-muted)';
    btn.style.color = 'var(--text-primary)';
  } else {
    btn.style.borderColor = '';
    btn.style.color = '';
  }
  btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
}

function buildPills(container, values, stateSet, colorFor){
  function makePill(label, value){
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'pill';
    var dot = document.createElement('span'); dot.className = 'dot';
    if (value && colorFor) dot.style.background = colorFor(value);
    b.appendChild(dot);
    var txt = document.createElement('span'); txt.textContent = label;
    b.appendChild(txt);
    if (value) b.dataset.value = value;
    return b;
  }
  container.innerHTML = '';
  container.appendChild(makePill('Todas', ''));
  values.forEach(function(v){ container.appendChild(makePill(v, v)); });

  function sync(){
    var curValues = container._pillValues || values;
    var curSet = container._pillStateSet || stateSet;
    var allSelected = curValues.every(function(v){ return curSet.has(v); });
    Array.from(container.querySelectorAll('.pill')).forEach(function(btn){
      var v = btn.dataset.value;
      var pressed = v ? (curSet.has(v) && !allSelected) : allSelected;
      updatePillStyle(btn, v, pressed, colorFor);
    });
  }

  container._pillValues = values;
  container._pillStateSet = stateSet;

  if (!container._pillsBound){
    container._pillsBound = true;
    container.addEventListener('click', function(e){
      var btn = e.target.closest('.pill');
      if (!btn) return;
      var v = btn.dataset.value;
      var curValues = container._pillValues;
      var curSet = container._pillStateSet;
      if (!v){
        curSet.clear();
        curValues.forEach(function(x){ curSet.add(x); });
      } else if (curSet.has(v) && curSet.size === 1){
        curSet.clear();
        curValues.forEach(function(x){ curSet.add(x); });
      } else {
        curSet.clear();
        curSet.add(v);
      }
      container._pillsSync();
      render();
    });
  }
  container._pillsSync = sync;
  sync();
}

/* ---------- chart geometry ---------- */
var W = 920, H = 460;
var M = { top: 18, right: 26, bottom: 60, left: 54 };
var plotW = W - M.left - M.right;
var plotH = H - M.top - M.bottom;
var yMax = 1.10, yMin = 0.30;
function xScale(pct){ return M.left + pct * plotW; }
function yScale(spi){ return M.top + (yMax - spi) / (yMax - yMin) * plotH; }

function el(tag, attrs, parent){
  var e = document.createElementNS(SVGNS, tag);
  for (var k in attrs){ e.setAttribute(k, attrs[k]); }
  if (parent) parent.appendChild(e);
  return e;
}

function buildStaticChart(){
  var svg = document.getElementById('chart');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  el('rect', { x: M.left, y: yScale(yMax), width: plotW, height: yScale(1) - yScale(yMax), class: 'band-good' }, svg);
  el('rect', { x: M.left, y: yScale(1), width: plotW, height: yScale(0.85) - yScale(1), class: 'band-warn' }, svg);
  el('rect', { x: M.left, y: yScale(0.85), width: plotW, height: yScale(yMin) - yScale(0.85), class: 'band-crit' }, svg);

  for (var xv = 0; xv <= 1.0001; xv += 0.2){
    var gx = xScale(xv);
    el('line', { x1: gx, x2: gx, y1: M.top, y2: M.top + plotH, class: 'gridline' }, svg);
  }
  for (var yv = yMin; yv <= yMax + 0.0001; yv += 0.1){
    var gy = yScale(yv);
    el('line', { x1: M.left, x2: M.left + plotW, y1: gy, y2: gy, class: 'gridline' }, svg);
    var t = el('text', { x: M.left - 10, y: gy + 3.5, class: 'tick-label', 'text-anchor': 'end' }, svg);
    t.textContent = yv.toFixed(2);
  }

  [0, 0.2, 0.4, 0.6, 0.8, 1].forEach(function(v){
    var x = xScale(v);
    var t = el('text', { x: x, y: M.top + plotH + 20, class: 'tick-label', 'text-anchor': 'middle' }, svg);
    t.textContent = Math.round(v * 100) + '%';
  });

  el('line', { x1: M.left, x2: M.left + plotW, y1: M.top + plotH, y2: M.top + plotH, class: 'baseline' }, svg);
  el('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + plotH, class: 'baseline' }, svg);

  var ty = yScale(1);
  el('line', { x1: M.left, x2: M.left + plotW, y1: ty, y2: ty, class: 'spi-target' }, svg);
  var lbl = el('text', { x: M.left + plotW, y: ty - 6, class: 'spi-target-label', 'text-anchor': 'end' }, svg);
  lbl.textContent = 'Meta / limite bom (SPI = 1,00)';

  var ty2 = yScale(0.85);
  el('line', { x1: M.left, x2: M.left + plotW, y1: ty2, y2: ty2, class: 'spi-target' }, svg);
  var lbl2 = el('text', { x: M.left + plotW, y: ty2 - 6, class: 'spi-target-label', 'text-anchor': 'end' }, svg);
  lbl2.textContent = 'Limite atenção / crítico (0,85)';

  var xt = el('text', { x: M.left + plotW / 2, y: H - 6, class: 'axis-label', 'text-anchor': 'middle' }, svg);
  xt.textContent = '% físico concluído';
  var yt = el('text', { x: -(M.top + plotH / 2), y: 16, class: 'axis-label', 'text-anchor': 'middle', transform: 'rotate(-90)' }, svg);
  yt.textContent = 'SPI (índice de desempenho de prazo)';
}

/* ---------- histórico de SPI por semana de um projeto (substitui a dispersão no próprio gráfico principal) ---------- */
function projectTrendRows(project){
  // só semanas em que o projeto realmente andou (% concluído > 0) — antes
  // disso o SPI é só um valor de espera (geralmente 1,00) sem significado,
  // e só polui o gráfico de histórico.
  return DATA.filter(function(d){ return d.project === project && d.pct_complete > 0; }).sort(function(a, b){
    return a.week < b.week ? -1 : a.week > b.week ? 1 : 0;
  });
}
function trendXScale(i, count){
  return count > 1 ? M.left + (i / (count - 1)) * plotW : M.left + plotW / 2;
}
// desenha o fundo do modo "histórico" (faixas de status, grade, linhas de meta e
// o eixo X com uma marca por semana) diretamente no <svg id="chart">, usando a
// mesma geometria (W/H/M) do gráfico de dispersão para a troca ser instantânea.
function buildTrendStaticChart(rows){
  var svg = document.getElementById('chart');
  if (!svg) return;
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  el('rect', { x: M.left, y: yScale(yMax), width: plotW, height: yScale(1) - yScale(yMax), class: 'band-good' }, svg);
  el('rect', { x: M.left, y: yScale(1), width: plotW, height: yScale(0.85) - yScale(1), class: 'band-warn' }, svg);
  el('rect', { x: M.left, y: yScale(0.85), width: plotW, height: yScale(yMin) - yScale(0.85), class: 'band-crit' }, svg);

  for (var yv = yMin; yv <= yMax + 0.0001; yv += 0.1){
    var gy = yScale(yv);
    el('line', { x1: M.left, x2: M.left + plotW, y1: gy, y2: gy, class: 'gridline' }, svg);
    var t = el('text', { x: M.left - 10, y: gy + 3.5, class: 'tick-label', 'text-anchor': 'end' }, svg);
    t.textContent = yv.toFixed(2);
  }

  // com muitas semanas as marcas do eixo X ficam coladas umas nas outras; a
  // partir de um certo número de semanas, mostra só 1 a cada N (sempre incluindo
  // a última) e inclina o texto para caber sem sobrepor.
  var xLabelStep = rows.length > 1 ? Math.max(1, Math.ceil(26 / (plotW / (rows.length - 1)))) : 1;
  rows.forEach(function(d, i){
    if (i % xLabelStep !== 0 && i !== rows.length - 1) return;
    var x = trendXScale(i, rows.length);
    var y = M.top + plotH + 16;
    var xt = el('text', { x: x, y: y, class: 'tick-label', 'text-anchor': 'end',
      transform: 'rotate(-40 ' + x + ' ' + y + ')' }, svg);
    xt.textContent = fmtDateMDY(d.date);
  });

  el('line', { x1: M.left, x2: M.left + plotW, y1: M.top + plotH, y2: M.top + plotH, class: 'baseline' }, svg);
  el('line', { x1: M.left, x2: M.left, y1: M.top, y2: M.top + plotH, class: 'baseline' }, svg);

  var ty = yScale(1);
  el('line', { x1: M.left, x2: M.left + plotW, y1: ty, y2: ty, class: 'spi-target' }, svg);
  var lbl = el('text', { x: M.left + plotW, y: ty - 6, class: 'spi-target-label', 'text-anchor': 'end' }, svg);
  lbl.textContent = 'Meta / limite bom (SPI = 1,00)';

  var ty2 = yScale(0.85);
  el('line', { x1: M.left, x2: M.left + plotW, y1: ty2, y2: ty2, class: 'spi-target' }, svg);
  var lbl2 = el('text', { x: M.left + plotW, y: ty2 - 6, class: 'spi-target-label', 'text-anchor': 'end' }, svg);
  lbl2.textContent = 'Limite atenção / crítico (0,85)';

  var xt2 = el('text', { x: M.left + plotW / 2, y: H - 6, class: 'axis-label', 'text-anchor': 'middle' }, svg);
  xt2.textContent = 'Data de referência';
  var yt2 = el('text', { x: -(M.top + plotH / 2), y: 16, class: 'axis-label', 'text-anchor': 'middle', transform: 'rotate(-90)' }, svg);
  yt2.textContent = 'SPI (índice de desempenho de prazo)';
}
// desenha a linha e os pontos do histórico por cima do fundo montado acima.
function drawTrendSeries(rows){
  var svg = document.getElementById('chart');
  if (!svg || !rows.length) return;
  var pointsStr = rows.map(function(d, i){
    return trendXScale(i, rows.length) + ',' + yScale(Math.min(Math.max(d.spi, yMin), yMax));
  }).join(' ');
  el('polyline', { points: pointsStr, class: 'trend-line' }, svg);

  rows.forEach(function(d, i){
    var cx = trendXScale(i, rows.length);
    var cy = yScale(Math.min(Math.max(d.spi, yMin), yMax));
    var color = STATUS_COLOR[statusOf(d.spi)];

    var hit = el('circle', { class: 'dot-hit', cx: cx, cy: cy, r: 13, tabindex: '0', role: 'img',
      'aria-label': fmtDateMDY(d.date) + ', SPI ' + fmtSpi(d.spi) }, svg);
    var titleEl = el('title', {}, hit);
    titleEl.textContent = fmtDateMDY(d.date) + ' — SPI ' + fmtSpi(d.spi) + ' (' + fmtPct(d.pct_complete) + ' concluído)';
    el('circle', { class: 'dot-mark', cx: cx, cy: cy, r: 5, fill: color }, svg);

    var vt = el('text', { x: cx, y: cy - 12, class: 'trend-point-label', 'text-anchor': 'middle' }, svg);
    vt.textContent = fmtSpi(d.spi);
  });
}

// alterna o título/nota acima do gráfico e o botão de voltar, conforme o modo:
// null/false = dispersão, 'project' = histórico de 1 projeto, 'grid' = grade
// com o histórico de SPI de cada projeto da seleção atual (empresa/escopo).
function updateChartHeading(mode, name, count){
  var titleEl = document.getElementById('chartCardTitle');
  var noteEl = document.getElementById('chartCardNote');
  var backBtn = document.getElementById('btnBackToScatter');
  var gridBtn = document.getElementById('btnCompanyGridToggle');
  var statusPills = document.getElementById('companyStatusPills');
  var svg = document.getElementById('chart');
  if (mode === 'project'){
    if (titleEl) titleEl.textContent = 'Histórico de SPI — ' + name;
    if (noteEl) noteEl.textContent = 'SPI de "' + name + '" em cada semana com avanço registrado (' + count + ' semana(s)).';
    if (backBtn) backBtn.hidden = false;
    if (gridBtn) gridBtn.hidden = true;
    if (statusPills) statusPills.hidden = true;
    if (svg) svg.setAttribute('aria-label', 'Gráfico de SPI por semana para ' + name);
  } else if (mode === 'isolated'){
    // dispersão normal, mas recortada para um único projeto (isolado pela tabela,
    // não pelo clique no ponto do gráfico) — mesmo assim precisa do botão de
    // voltar, senão não há como sair do recorte a não ser pela tabela. Esconde
    // os outros botões (grade / status), igual ao modo de histórico, para que
    // o botão de voltar sempre fique sozinho no mesmo canto do cabeçalho do
    // gráfico, na mesma posição, em qualquer um dos modos em que ele aparece.
    if (titleEl) titleEl.textContent = 'Dispersão — SPI por % físico concluído';
    if (noteEl) noteEl.textContent = 'mostrando apenas "' + name + '". Clique em "Ver todos os projetos" para voltar à seleção completa.';
    if (backBtn) backBtn.hidden = false;
    if (gridBtn) gridBtn.hidden = true;
    if (statusPills) statusPills.hidden = true;
    if (svg) svg.setAttribute('aria-label', 'Gráfico de dispersão de SPI por percentual concluído, projeto isolado: ' + name);
  } else if (mode === 'grid'){
    if (titleEl) titleEl.textContent = 'SPI ao longo do tempo — por projeto';
    if (noteEl) noteEl.textContent = 'SPI de cada projeto da seleção atual, por semana com avanço registrado (' + count + ' projeto(s)). Clique num card para ver o histórico completo do projeto.';
    if (backBtn) backBtn.hidden = true;
    if (gridBtn) gridBtn.hidden = false;
    if (statusPills) statusPills.hidden = false;
    if (svg) svg.setAttribute('aria-label', 'Grade com o histórico de SPI por semana de cada projeto da seleção atual');
  } else {
    if (titleEl) titleEl.textContent = 'Dispersão — SPI por % físico concluído';
    if (noteEl) noteEl.textContent = 'cada ponto = um projeto na semana selecionada. Clique em um ponto para ver o histórico de SPI por semana. Use os botões de status para ocultar pontos.';
    if (backBtn) backBtn.hidden = true;
    if (gridBtn) gridBtn.hidden = false;
    if (statusPills) statusPills.hidden = false;
    if (svg) svg.setAttribute('aria-label', 'Gráfico de dispersão de SPI por percentual concluído, por projeto');
  }
}
function exitTrendMode(){
  state.isolatedProject = null;
  state.trendMode = false;
  state.companyGridView = false;
  state.companyStatusFilter = { good: true, warn: true, crit: true };
  var gridBtn = document.getElementById('btnCompanyGridToggle');
  if (gridBtn) gridBtn.textContent = 'Ver em grade';
  var statusPills = document.getElementById('companyStatusPills');
  if (statusPills) statusPills.querySelectorAll('.pill').forEach(function(b){ b.setAttribute('aria-pressed', 'true'); });
  render();
}

/* ---------- histórico de SPI por semana de todos os projetos da seleção atual ---------- */
// agrupa os lançamentos por projeto, respeitando os filtros de Empresa e Escopo
// da tela (mas não o filtro de semana — a grade mostra o histórico completo) e
// os projetos excluídos.
function filteredTrendGroups(){
  // só semanas com avanço físico real (% concluído > 0) — antes disso o SPI
  // é só um valor de espera, sem significado, e um projeto sem nenhuma
  // semana assim simplesmente não aparece (não há o que comparar).
  var rows = DATA.filter(function(d){
    return state.companies.has(d.company) && state.scopes.has(d.scope) && !excludedProjects.has(d.project) && d.pct_complete > 0;
  });
  var byProject = {};
  rows.forEach(function(d){
    if (!byProject[d.project]) byProject[d.project] = [];
    byProject[d.project].push(d);
  });
  var weekSet = {};
  rows.forEach(function(d){ weekSet[d.week] = true; });
  var weekList = Object.keys(weekSet).sort();
  var groups = Object.keys(byProject).sort(function(a, b){ return a.localeCompare(b); }).map(function(project){
    var prows = byProject[project].slice().sort(function(a, b){ return a.week < b.week ? -1 : a.week > b.week ? 1 : 0; });
    var latest = prows[prows.length - 1];
    return { project: project, rows: prows, latest: latest, status: statusOf(latest.spi) };
  });
  return { weeks: weekList, groups: groups };
}
// versão "small multiples" do histórico por empresa: uma mini-linha por
// projeto, lado a lado, em vez de todas sobrepostas no mesmo gráfico — mais
// fácil de comparar quando há muitos projetos. Ordenado do pior para o
// melhor (crítico > atenção > bom; dentro do mesmo status, SPI mais baixo
// primeiro), para os projetos que mais precisam de atenção aparecerem primeiro.
function renderCompanyGrid(companyData){
  var container = document.getElementById('companyGrid');
  if (!container) return;
  container.innerHTML = '';
  if (!companyData.groups.length){
    var empty = document.createElement('div'); empty.className = 'grid-empty';
    empty.textContent = 'Nenhum projeto para esta seleção de status.';
    container.appendChild(empty);
    return;
  }
  var weekList = companyData.weeks;
  var order = { crit: 0, warn: 1, good: 2 };
  var sorted = companyData.groups.slice().sort(function(a, b){
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    return a.latest.spi - b.latest.spi;
  });

  var GW = 260, GH = 130;
  var gM = { left: 4, right: 4, top: 8, bottom: 4 };
  var gPlotW = GW - gM.left - gM.right, gPlotH = GH - gM.top - gM.bottom;
  function gY(spi){ return gM.top + (yMax - Math.min(Math.max(spi, yMin), yMax)) / (yMax - yMin) * gPlotH; }
  function gX(week){
    var idx = weekList.indexOf(week);
    return weekList.length > 1 ? gM.left + (idx / (weekList.length - 1)) * gPlotW : gM.left + gPlotW / 2;
  }

  sorted.forEach(function(p){
    var card = document.createElement('div');
    card.className = 'grid-card';
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', p.project + ', SPI atual ' + fmtSpi(p.latest.spi) + ', status ' + statusLabel[p.status] + '. Clique para ver o histórico completo.');

    var head = document.createElement('div'); head.className = 'grid-card-head';
    var name = document.createElement('span'); name.className = 'grid-card-name'; name.textContent = p.project; name.title = p.project;
    var val = document.createElement('span'); val.className = 'grid-card-spi ' + p.status; val.textContent = fmtSpi(p.latest.spi);
    head.appendChild(name); head.appendChild(val);
    card.appendChild(head);

    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + GW + ' ' + GH);
    svg.setAttribute('class', 'grid-card-svg');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'SPI de ' + p.project + ' por semana');

    el('rect', { x: gM.left, y: gY(yMax), width: gPlotW, height: gY(1) - gY(yMax), class: 'band-good' }, svg);
    el('rect', { x: gM.left, y: gY(1), width: gPlotW, height: gY(0.85) - gY(1), class: 'band-warn' }, svg);
    el('rect', { x: gM.left, y: gY(0.85), width: gPlotW, height: gY(yMin) - gY(0.85), class: 'band-crit' }, svg);
    el('line', { x1: gM.left, x2: gM.left + gPlotW, y1: gY(1), y2: gY(1), class: 'spi-target' }, svg);
    el('line', { x1: gM.left, x2: gM.left + gPlotW, y1: gY(0.85), y2: gY(0.85), class: 'spi-target' }, svg);

    var pts = p.rows.map(function(d){ return gX(d.week) + ',' + gY(d.spi); }).join(' ');
    var color = STATUS_COLOR[p.status];
    el('polyline', { points: pts, class: 'spi-line', stroke: color, style: 'opacity:1' }, svg);
    var lastCx = gX(p.latest.week), lastCy = gY(p.latest.spi);
    el('circle', { cx: lastCx, cy: lastCy, r: 3.5, fill: color, class: 'spi-dot', style: 'opacity:1' }, svg);

    card.appendChild(svg);

    var foot = document.createElement('div'); foot.className = 'grid-card-foot';
    foot.textContent = p.rows.length + ' semana(s) com avanço · até ' + fmtDateMDY(dateFromWeekLabel(p.latest.week));
    card.appendChild(foot);

    function drill(){
      state.companyGridView = false;
      state.isolatedProject = p.project;
      state.trendMode = true;
      render();
    }
    card.addEventListener('click', drill);
    card.addEventListener('keydown', function(e){ if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); drill(); } });

    container.appendChild(card);
  });
}
function initTrendMode(){
  var backBtn = document.getElementById('btnBackToScatter');
  if (backBtn) backBtn.addEventListener('click', exitTrendMode);

  var gridBtn = document.getElementById('btnCompanyGridToggle');
  if (gridBtn) gridBtn.addEventListener('click', function(){
    state.companyGridView = !state.companyGridView;
    gridBtn.textContent = state.companyGridView ? 'Ver dispersão' : 'Ver em grade';
    render();
  });

  var statusPills = document.getElementById('companyStatusPills');
  if (statusPills) statusPills.querySelectorAll('.pill').forEach(function(btn){
    btn.addEventListener('click', function(){
      var s = btn.getAttribute('data-status');
      state.companyStatusFilter[s] = !state.companyStatusFilter[s];
      btn.setAttribute('aria-pressed', String(state.companyStatusFilter[s]));
      render();
    });
  });
}

/* Labels every point with its project name using real collision detection
   (each label's measured bounding box vs. every label already placed), not
   just a per-side vertical stack — so labels don't overlap even when many
   points cluster close together in both x and y, and it re-solves itself on
   every render, so it keeps working as projects are added, removed or
   isolated. A short leader line is drawn whenever a label had to move away
   from its dot to find a free spot. */
function placeDirectLabels(rows, svg){
  var labelH = 10;   // altura aproximada de uma linha de rótulo (fonte 8px)
  var vGap = 2;       // espaço mínimo entre rótulos vizinhos
  var hPad = 8;       // distância entre o ponto e o rótulo, na posição natural
  var maxSteps = 40;   // quantos "degraus" verticais tenta antes de desistir
  var top = M.top + 5, bottom = M.top + plotH - 3;

  // 1) cria (e já anexa, para poder medir a largura real com o CSS aplicado)
  //    um <text> por projeto, na posição natural do ponto.
  var firstTextNode = null;
  var items = rows.map(function(d){
    var cx = xScale(Math.min(Math.max(d.pct_complete, 0), 1));
    var cy = yScale(Math.min(Math.max(d.spi, yMin), yMax));
    var label = d.project; // no gráfico mostra só o nome do projeto, sem o código — o código completo continua na tabela e no tooltip
    var t = el('text', { class: 'direct-label', x: cx, y: cy }, svg);
    t.textContent = label;
    if (!firstTextNode) firstTextNode = t;
    var width = 0;
    try { width = t.getComputedTextLength(); } catch (e) { /* segue com 0 e usa a estimativa abaixo */ }
    if (!width) width = label.length * 4.6;
    return { d: d, cx: cx, cy: cy, width: width, textEl: t };
  });

  // 2) ordem estável e previsível (esquerda→direita, depois cima→baixo) —
  //    assim o layout muda pouco de uma atualização para a outra quando um
  //    projeto novo entra ou sai da seleção.
  items.sort(function(a, b){ return (a.cx - b.cx) || (a.cy - b.cy); });

  // trata os rótulos fixos das linhas de meta/limite como obstáculos, para
  // que os rótulos de projeto também desviem deles, não só uns dos outros.
  var placed = Array.from(svg.querySelectorAll('.spi-target-label')).map(function(lbl){
    var b = lbl.getBBox();
    return { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
  });
  function boxFor(anchorX, anchorY, width, side){
    var left = side === 'right' ? anchorX : anchorX - width;
    return { left: left, top: anchorY - labelH / 2, right: left + width, bottom: anchorY + labelH / 2 };
  }
  function overlapScore(box){
    var score = 0;
    for (var i = 0; i < placed.length; i++){
      var p = placed[i];
      if (!(box.right + vGap <= p.left || box.left >= p.right + vGap || box.bottom + vGap <= p.top || box.top >= p.bottom + vGap)) score++;
    }
    return score;
  }
  function verticalSteps(){
    var steps = [0];
    for (var s = 1; s <= maxSteps; s++){
      var mag = Math.ceil(s / 2) * (labelH + vGap);
      steps.push(s % 2 ? mag : -mag);
    }
    return steps;
  }
  var dySteps = verticalSteps();
  var leaderLines = [];

  items.forEach(function(it){
    var preferredSide = (it.cx - M.left) > plotW / 2 ? 'left' : 'right';
    var sides = [preferredSide, preferredSide === 'right' ? 'left' : 'right'];
    var chosen = null;
    var best = null; // melhor tentativa vista até agora, mesmo que ainda sobreponha algo

    for (var si = 0; si < sides.length && !chosen; si++){
      var side = sides[si];
      var anchorX = side === 'right' ? (it.cx + hPad) : (it.cx - hPad);
      for (var di = 0; di < dySteps.length; di++){
        var anchorY = Math.min(Math.max(it.cy + dySteps[di], top), bottom);
        var box = boxFor(anchorX, anchorY, it.width, side);
        var score = overlapScore(box);
        if (score === 0){
          chosen = { side: side, anchorX: anchorX, anchorY: anchorY, box: box };
          break;
        }
        if (!best || score < best.score){
          best = { side: side, anchorX: anchorX, anchorY: anchorY, box: box, score: score };
        }
      }
    }
    // aglomerado extremo, sem nenhum degrau totalmente livre: fica com a
    // tentativa que sobrepõe o menor número de rótulos, em vez de empilhar
    // tudo na posição natural do ponto.
    if (!chosen) chosen = best;
    placed.push(chosen.box);

    it.textEl.setAttribute('x', chosen.anchorX);
    it.textEl.setAttribute('y', chosen.anchorY + 2.8);
    it.textEl.setAttribute('text-anchor', chosen.side === 'right' ? 'start' : 'end');

    if (Math.abs(chosen.anchorY - it.cy) > 2.5 || chosen.side !== preferredSide){
      leaderLines.push({
        x1: it.cx + (chosen.side === 'right' ? 5 : -5), y1: it.cy,
        x2: chosen.anchorX + (chosen.side === 'right' ? -2 : 2), y2: chosen.anchorY
      });
    }
  });

  // as linhas guia são inseridas antes do primeiro rótulo, para ficarem
  // visualmente atrás do texto de todos os projetos, não só do seu próprio.
  leaderLines.forEach(function(l){
    var line = el('line', { x1: l.x1, y1: l.y1, x2: l.x2, y2: l.y2, class: 'label-leader' }, null);
    if (firstTextNode) svg.insertBefore(line, firstTextNode);
    else svg.appendChild(line);
  });
}

function showTooltip(cx, cy, d, pinned){
  var tooltip = document.getElementById('tooltip');
  tooltip.innerHTML = '';
  var st = statusOf(d.spi);
  var name = document.createElement('div'); name.className = 't-name'; name.textContent = projectLabel(d);
  var sub = document.createElement('div'); sub.className = 't-sub'; sub.textContent = d.company + ' · ' + d.scope;
  tooltip.appendChild(name); tooltip.appendChild(sub);
  [['% concluído', fmtPct(d.pct_complete)], ['SPI', fmtSpi(d.spi)], ['Status', statusLabel[st]], ['Data de referência', fmtDateMDY(d.date)]].forEach(function(pair){
    var row = document.createElement('div'); row.className = 't-row';
    var key = document.createElement('span'); key.className = 't-key'; key.textContent = pair[0];
    var val = document.createElement('span'); val.className = 't-val'; val.textContent = pair[1];
    row.appendChild(key); row.appendChild(val);
    tooltip.appendChild(row);
  });
  tooltip.classList.add('show');
  positionTooltip(cx, cy);
}
function positionTooltip(cx, cy){
  var tooltip = document.getElementById('tooltip');
  var svg = document.getElementById('chart');
  var shell = document.getElementById('chartShell');
  var svgRect = svg.getBoundingClientRect();
  var shellRect = shell.getBoundingClientRect();
  var scale = svgRect.width / W;
  var x = svgRect.left - shellRect.left + cx * scale;
  var y = svgRect.top - shellRect.top + cy * scale;
  tooltip.style.left = x + 'px';
  tooltip.style.top = y + 'px';

  var w = tooltip.offsetWidth;
  var h = tooltip.offsetHeight;
  var gap = 14;

  // Horizontal bounds for the tooltip: keep it within the plotted area
  // itself, not the whole shell — the shell also contains the y-axis tick
  // labels (left of M.left) and a bit of margin on the right, and letting the
  // tooltip spill into those makes it overlap the axis text.
  var plotLeftBound = svgRect.left - shellRect.left + M.left * scale;
  var plotRightBound = svgRect.left - shellRect.left + (M.left + plotW) * scale;
  // Same idea vertically: stay within the plotted area, not the whole shell —
  // the shell also contains the x-axis tick labels and axis title below the
  // plot (in the M.bottom margin), so letting the tooltip spill down there
  // makes it overlap that text too.
  var plotTopBound = svgRect.top - shellRect.top + M.top * scale;
  var plotBottomBound = svgRect.top - shellRect.top + (M.top + plotH) * scale;

  function rectsOverlap(a, b){
    return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  }
  // avoid both the fixed reference-line labels and the chart's own per-point
  // direct labels (the small project-name text next to each dot) — the
  // latter matter most in isolation view, where the tooltip must not cover
  // the very label naming the point it describes.
  var labelEls = document.querySelectorAll('.spi-target-label, .direct-label');
  var labelPad = 6; // inflate label rects so the tooltip keeps a visible breathing gap, not just a technical non-overlap
  var labelRects = Array.from(labelEls).map(function(el){
    var lr = el.getBoundingClientRect();
    return {
      left: lr.left - shellRect.left - labelPad, top: lr.top - shellRect.top - labelPad,
      right: lr.right - shellRect.left + labelPad, bottom: lr.bottom - shellRect.top + labelPad
    };
  });

  var txCenter = -(w / 2);

  // For a given vertical placement, try a short list of horizontal offsets
  // and accept the first one that is genuinely free of collisions against
  // EVERY label (not just the ones that happened to trigger the offset) —
  // so a fix aimed at one label can never quietly reintroduce an overlap
  // with another. Candidates: centered on the point, and fully left/right of
  // whatever labels share this row, tried closest-to-centered first.
  function solveForTy(ty){
    var top = y + ty, bottom = top + h;
    if (top < plotTopBound || bottom > plotBottomBound) return null; // doesn't fit vertically at all

    function fullyClear(tx){
      var left = x + tx, right = left + w;
      if (left < plotLeftBound || right > plotRightBound) return false;
      var rect = { left: left, top: top, right: right, bottom: bottom };
      for (var i = 0; i < labelRects.length; i++){
        if (rectsOverlap(rect, labelRects[i])) return false;
      }
      return true;
    }

    var rowLabels = labelRects.filter(function(l){ return !(bottom <= l.top || top >= l.bottom); });
    var candidates = [txCenter];
    // a shell-clamped variant of center, in case the point sits close enough
    // to the plot's left/right edge that the centered box would spill out
    // even with no labels in the way.
    var leftC = x + txCenter, rightC = leftC + w, txClamped = txCenter;
    if (leftC < plotLeftBound) txClamped += (plotLeftBound - leftC);
    else if (rightC > plotRightBound) txClamped -= (rightC - plotRightBound);
    if (txClamped !== txCenter) candidates.push(txClamped);
    if (rowLabels.length){
      var minLeft = Math.min.apply(null, rowLabels.map(function(l){ return l.left; }));
      var maxRight = Math.max.apply(null, rowLabels.map(function(l){ return l.right; }));
      candidates.push(minLeft - w - x);  // tooltip fully left of every label on this row
      candidates.push(maxRight - x);     // tooltip fully right of every label on this row
    }
    candidates.sort(function(a, b){ return Math.abs(a - txCenter) - Math.abs(b - txCenter); });

    for (var i = 0; i < candidates.length; i++){
      if (fullyClear(candidates[i])) return { ty: ty, tx: candidates[i], shift: Math.abs(candidates[i] - txCenter) };
    }
    return null;
  }

  var tyAbove = -(h + gap);
  var tyBelow = gap;
  var solAbove = solveForTy(tyAbove);
  var solBelow = solveForTy(tyBelow);

  var chosen;
  if (solAbove && solBelow) chosen = (solAbove.shift <= solBelow.shift) ? solAbove : solBelow;
  else chosen = solAbove || solBelow;

  if (!chosen){
    // Neither side has room to fully clear the labels within the shell —
    // extremely rare (very tall tooltip, dense chart). Fall back to
    // whichever vertical side has more open room, clamped horizontally.
    var ty = (y < shellRect.height / 2) ? tyBelow : tyAbove;
    var top = y + ty, bottom = top + h;
    if (top < plotTopBound) ty += (plotTopBound - top);
    else if (bottom > plotBottomBound) ty -= (bottom - plotBottomBound);
    var tx = txCenter;
    var left = x + tx, right = left + w;
    if (left < plotLeftBound) tx += (plotLeftBound - left);
    else if (right > plotRightBound) tx -= (right - plotRightBound);
    chosen = { ty: ty, tx: tx };
  }

  tooltip.style.transform = 'translate(' + chosen.tx + 'px, ' + chosen.ty + 'px)';
}
function hideTooltip(){
  if (state.isolatedProject && !state.trendMode) return; // keep the tooltip pinned open while a project is isolated (scatter mode only)
  var t = document.getElementById('tooltip'); if (t) t.classList.remove('show');
}

function renderLegend(){
  var legend = document.getElementById('legend');
  if (!legend) return;
  legend.innerHTML = '';
  function addItem(label, color){
    var item = document.createElement('div'); item.className = 'legend-item';
    var sw = document.createElement('span'); sw.className = 'legend-swatch'; sw.style.background = color;
    var txt = document.createElement('span'); txt.textContent = label;
    item.appendChild(sw); item.appendChild(txt);
    legend.appendChild(item);
  }
  addItem('Bom — SPI > 1,00', STATUS_COLOR.good);
  addItem('Atenção — SPI 0,85 a 1,00', STATUS_COLOR.warn);
  addItem('Crítico — SPI < 0,85', STATUS_COLOR.crit);
  var lineItem = document.createElement('div'); lineItem.className = 'legend-item';
  var line = document.createElement('span'); line.className = 'legend-line';
  var ltxt = document.createElement('span'); ltxt.textContent = 'Faixas de SPI (1,00 / 0,85)';
  lineItem.appendChild(line); lineItem.appendChild(ltxt);
  legend.appendChild(lineItem);
}

function populateDatalists(){
  function fill(id, values){
    var dl = document.getElementById(id);
    if (!dl) return;
    dl.innerHTML = '';
    values.forEach(function(v){ var o = document.createElement('option'); o.value = v; dl.appendChild(o); });
  }
  fill('companyList', companies);
  fill('scopeList', scopes);
  fill('projectList', Array.from(new Set(DATA.map(function(d){ return d.project; }))).sort());
  fill('projectCodeList', Array.from(new Set(DATA.map(function(d){ return d.id; }))).filter(Boolean).sort());
}

function currentRows(){
  return DATA.filter(function(d){
    return d.week === state.week && state.companies.has(d.company) && state.scopes.has(d.scope) && !excludedProjects.has(d.project);
  });
}

/* ---------- exclusão de projetos (reversível, vale para todas as semanas) ---------- */
async function loadExcluded(){
  if (!supabaseClient){ excludedProjects = new Set(); return; }
  try {
    var res = await supabaseClient.from('app_state').select('excluded_projects').eq('id', 'global').maybeSingle();
    var arr = (res.data && Array.isArray(res.data.excluded_projects)) ? res.data.excluded_projects : [];
    excludedProjects = new Set(arr);
  } catch (e) {
    excludedProjects = new Set();
  }
}
async function persistExcluded(){
  return await persistState();
}
function updateExcludedButtonLabel(){
  var btn = document.getElementById('btnManageExcluded');
  if (!btn) return;
  var n = excludedProjects.size;
  btn.textContent = n ? ('Projetos excluídos (' + n + ')') : 'Projetos excluídos';
}
async function excludeProject(project){
  excludedProjects.add(project);
  if (state.isolatedProject === project){ state.isolatedProject = null; state.trendMode = false; }
  await persistExcluded();
  updateExcludedButtonLabel();
  render();
  showToast('"' + project + '" foi excluído do painel em todas as semanas. Use "Projetos excluídos" para reincluí-lo.', '');
}
async function includeProject(project){
  excludedProjects.delete(project);
  await persistExcluded();
  updateExcludedButtonLabel();
  renderExcludedList();
  render();
  showToast('"' + project + '" foi reincluído no painel.', '');
}

/* ---------- confirmação antes de excluir um projeto ---------- */
var pendingExcludeProject = null;
function openExcludeConfirm(project){
  pendingExcludeProject = project;
  var textEl = document.getElementById('excludeConfirmText');
  if (textEl) textEl.textContent = 'O projeto "' + project + '" será removido do gráfico, da tabela e dos indicadores em todas as semanas. Você pode reincluí-lo depois em "Projetos excluídos".';
  var overlay = document.getElementById('excludeConfirmOverlay');
  if (overlay) overlay.hidden = false;
}
function closeExcludeConfirm(){
  var overlay = document.getElementById('excludeConfirmOverlay');
  if (overlay) overlay.hidden = true;
  pendingExcludeProject = null;
}
function initExcludeConfirm(){
  var overlay = document.getElementById('excludeConfirmOverlay');
  if (!overlay) return;
  var noBtn = document.getElementById('excludeConfirmNo');
  var yesBtn = document.getElementById('excludeConfirmYes');
  if (noBtn) noBtn.addEventListener('click', closeExcludeConfirm);
  if (yesBtn) yesBtn.addEventListener('click', function(){
    var p = pendingExcludeProject;
    closeExcludeConfirm();
    if (p) excludeProject(p);
  });
  overlay.addEventListener('click', function(e){ if (e.target === overlay) closeExcludeConfirm(); });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape' && !overlay.hidden) closeExcludeConfirm(); });
}
function renderExcludedList(){
  var wrap = document.getElementById('excludedList');
  if (!wrap) return;
  wrap.innerHTML = '';
  var list = Array.from(excludedProjects).sort();
  if (!list.length){
    var e = document.createElement('div'); e.className = 'excluded-empty'; e.textContent = 'Nenhum projeto excluído.';
    wrap.appendChild(e);
    return;
  }
  list.forEach(function(p){
    var row = document.createElement('div'); row.className = 'excluded-row';
    var name = document.createElement('span'); name.className = 'excluded-name'; name.textContent = p;
    var btn = document.createElement('button'); btn.type = 'button'; btn.className = 'btn small'; btn.textContent = 'Reincluir';
    btn.addEventListener('click', function(){ includeProject(p); });
    row.appendChild(name); row.appendChild(btn);
    wrap.appendChild(row);
  });
}
function openExcludedModal(){
  renderExcludedList();
  var o = document.getElementById('excludedOverlay');
  if (o) o.hidden = false;
}
function closeExcludedModal(){
  var o = document.getElementById('excludedOverlay');
  if (o) o.hidden = true;
}
function initExcludedModal(){
  var btn = document.getElementById('btnManageExcluded');
  if (btn) btn.addEventListener('click', openExcludedModal);
  var closeBtn = document.getElementById('excludedClose');
  if (closeBtn) closeBtn.addEventListener('click', closeExcludedModal);
  var overlay = document.getElementById('excludedOverlay');
  if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) closeExcludedModal(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeExcludedModal();
  });
}

/* ---------- SPI por faixa / por empresa (respeita os filtros e a semana atuais) ---------- */
function weightedSpi(list){
  var sumBase = list.reduce(function(a, d){ return a + (Number(d.baseline_duration) || 0); }, 0);
  var sumSched = list.reduce(function(a, d){ return a + (Number(d.schedule_duration) || 0); }, 0);
  return sumSched > 0 ? sumBase / sumSched : null;
}
function spiCell(list){
  var td = document.createElement('td'); td.className = 'num';
  var spi = weightedSpi(list);
  if (spi === null){
    td.textContent = '—';
  } else {
    var span = document.createElement('span'); span.className = 'bd-val ' + statusOf(spi);
    span.textContent = fmtSpi(spi);
    td.appendChild(span);
  }
  return td;
}
/* ---------- relatório semanal (semana atual x semana anterior) ---------- */
function previousWeekOf(weekLabel){
  var idx = weeks.indexOf(weekLabel);
  if (idx <= 0) return null;
  return weeks[idx - 1];
}
function rowsForWeek(weekLabel){
  return DATA.filter(function(d){
    return d.week === weekLabel && state.companies.has(d.company) && state.scopes.has(d.scope) && !excludedProjects.has(d.project);
  });
}
var SPI_EPSILON = 0.0005;
function computeWeeklyComparison(currentWeek, previousWeek){
  var curRows = rowsForWeek(currentWeek);
  var prevRows = previousWeek ? rowsForWeek(previousWeek) : [];
  var prevByProject = {};
  prevRows.forEach(function(d){ prevByProject[d.project] = d; });
  var curByProject = {};
  curRows.forEach(function(d){ curByProject[d.project] = d; });

  var improved = [], worsened = [], unchanged = [], onlyInCurrent = [], onlyInPrevious = [];
  curRows.forEach(function(d){
    var prev = prevByProject[d.project];
    if (!prev){ onlyInCurrent.push(d); return; }
    var delta = (Number(d.spi) || 0) - (Number(prev.spi) || 0);
    var item = { project: d.project, company: d.company, prevSpi: prev.spi, curSpi: d.spi, delta: delta };
    if (delta > SPI_EPSILON) improved.push(item);
    else if (delta < -SPI_EPSILON) worsened.push(item);
    else unchanged.push(item);
  });
  prevRows.forEach(function(d){
    if (!curByProject[d.project]) onlyInPrevious.push(d);
  });
  improved.sort(function(a, b){ return b.delta - a.delta; });
  worsened.sort(function(a, b){ return a.delta - b.delta; });

  var curSpi = weightedSpi(curRows);
  var prevSpi = previousWeek ? weightedSpi(prevRows) : null;
  var globalDelta = (curSpi !== null && prevSpi !== null) ? (curSpi - prevSpi) : null;

  return {
    currentWeek: currentWeek,
    previousWeek: previousWeek,
    curSpi: curSpi,
    prevSpi: prevSpi,
    globalDelta: globalDelta,
    improved: improved,
    worsened: worsened,
    unchanged: unchanged,
    onlyInCurrent: onlyInCurrent,
    onlyInPrevious: onlyInPrevious
  };
}
var lastReport = null;
function renderWeeklyReport(report){
  lastReport = report;
  var subEl = document.getElementById('reportSub');
  if (subEl){
    subEl.textContent = report.previousWeek
      ? 'Comparando a semana ' + report.previousWeek + ' (anterior) com a semana ' + report.currentWeek + ' (atual). Respeita os filtros de empresa/escopo e os projetos excluídos.'
      : 'Não há semana anterior à semana ' + report.currentWeek + ' para comparar.';
  }

  var kpiPrev = document.getElementById('reportKpiPrev');
  var kpiCur = document.getElementById('reportKpiCur');
  var kpiDelta = document.getElementById('reportKpiDelta');
  if (kpiPrev) kpiPrev.textContent = report.prevSpi !== null ? fmtSpi(report.prevSpi) : '—';
  if (kpiCur) kpiCur.textContent = report.curSpi !== null ? fmtSpi(report.curSpi) : '—';
  if (kpiDelta){
    kpiDelta.className = 'report-kpi-value';
    if (report.globalDelta === null){
      kpiDelta.textContent = '—';
    } else {
      var sign = report.globalDelta > 0 ? '+' : '';
      kpiDelta.textContent = sign + fmtSpi(report.globalDelta);
      if (report.globalDelta > SPI_EPSILON) kpiDelta.classList.add('good');
      else if (report.globalDelta < -SPI_EPSILON) kpiDelta.classList.add('crit');
    }
  }

  var summaryEl = document.getElementById('reportSummary');
  if (summaryEl){
    summaryEl.className = 'report-summary';
    var headline;
    if (report.globalDelta === null){
      summaryEl.classList.add('neutral');
      headline = 'Ainda não há semana anterior para comparar o indicador global.';
    } else if (report.globalDelta > SPI_EPSILON){
      summaryEl.classList.add('good');
      headline = 'O SPI global MELHOROU: de ' + fmtSpi(report.prevSpi) + ' para ' + fmtSpi(report.curSpi) + ' (+' + fmtSpi(report.globalDelta) + ').';
    } else if (report.globalDelta < -SPI_EPSILON){
      summaryEl.classList.add('crit');
      headline = 'O SPI global PIOROU: de ' + fmtSpi(report.prevSpi) + ' para ' + fmtSpi(report.curSpi) + ' (' + fmtSpi(report.globalDelta) + ').';
    } else {
      headline = 'O SPI global se manteve estável em ' + fmtSpi(report.curSpi) + '.';
    }
    summaryEl.innerHTML = '';
    var summaryTitle = document.createElement('div');
    summaryTitle.className = 'report-summary-headline';
    summaryTitle.textContent = headline;
    var summarySub = document.createElement('div');
    summarySub.className = 'report-summary-sub';
    summarySub.textContent = report.improved.length + ' projeto(s) melhoraram, ' + report.worsened.length + ' projeto(s) pioraram, ' + report.unchanged.length + ' sem mudança.';
    summaryEl.appendChild(summaryTitle);
    summaryEl.appendChild(summarySub);
  }

  function renderList(containerId, titleId, list, labelWord, cls){
    var titleEl = document.getElementById(titleId);
    if (titleEl) titleEl.textContent = labelWord + ' (' + list.length + ')';
    var wrap = document.getElementById(containerId);
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!list.length){
      var e = document.createElement('div'); e.className = 'report-empty'; e.textContent = 'Nenhum projeto.';
      wrap.appendChild(e);
      return;
    }
    list.forEach(function(item){
      var row = document.createElement('div'); row.className = 'report-row';
      var name = document.createElement('span'); name.className = 'report-row-name'; name.textContent = item.project + ' (' + item.company + ')';
      var vals = document.createElement('span'); vals.className = 'report-row-vals';
      var sign = item.delta > 0 ? '+' : '';
      vals.innerHTML = fmtSpi(item.prevSpi) + ' <span class="report-arrow">&rarr;</span> ' + fmtSpi(item.curSpi) + ' <span class="report-delta ' + cls + '">(' + sign + fmtSpi(item.delta) + ')</span>';
      row.appendChild(name); row.appendChild(vals);
      wrap.appendChild(row);
    });
  }
  renderList('reportImprovedList', 'reportImprovedTitle', report.improved, 'Melhoraram', 'good');
  renderList('reportWorsenedList', 'reportWorsenedTitle', report.worsened, 'Pioraram', 'crit');

  var notesEl = document.getElementById('reportNotes');
  if (notesEl){
    var notes = [];
    if (report.onlyInCurrent.length) notes.push(report.onlyInCurrent.length + ' projeto(s) novo(s) nesta semana (sem SPI anterior para comparar): ' + report.onlyInCurrent.map(function(d){ return d.project; }).join(', ') + '.');
    if (report.onlyInPrevious.length) notes.push(report.onlyInPrevious.length + ' projeto(s) da semana anterior não aparecem nesta semana: ' + report.onlyInPrevious.map(function(d){ return d.project; }).join(', ') + '.');
    notesEl.textContent = notes.join(' ');
    notesEl.hidden = !notes.length;
  }
}
function buildReportText(report){
  var lines = [];
  lines.push('RELATÓRIO SEMANAL — SPI');
  lines.push('Semana atual: ' + report.currentWeek + (report.previousWeek ? ' | Semana anterior: ' + report.previousWeek : ' | Sem semana anterior para comparar'));
  lines.push('');
  if (report.globalDelta === null){
    lines.push('SPI global atual: ' + (report.curSpi !== null ? fmtSpi(report.curSpi) : '—') + ' (sem semana anterior para comparar)');
  } else {
    var trend = report.globalDelta > SPI_EPSILON ? 'MELHOROU' : (report.globalDelta < -SPI_EPSILON ? 'PIOROU' : 'ESTÁVEL');
    lines.push('Indicador global: ' + trend);
    lines.push('SPI semana anterior: ' + fmtSpi(report.prevSpi));
    lines.push('SPI semana atual: ' + fmtSpi(report.curSpi));
    lines.push('Variação: ' + (report.globalDelta > 0 ? '+' : '') + fmtSpi(report.globalDelta));
  }
  lines.push('');
  lines.push('RESUMO: ' + report.improved.length + ' projeto(s) melhoraram, ' + report.worsened.length + ' projeto(s) pioraram, ' + report.unchanged.length + ' sem mudança.');
  lines.push('');
  lines.push('PROJETOS QUE MELHORARAM (' + report.improved.length + ')');
  if (!report.improved.length) lines.push('  Nenhum.');
  report.improved.forEach(function(item){
    lines.push('  - ' + item.project + ' (' + item.company + '): ' + fmtSpi(item.prevSpi) + ' -> ' + fmtSpi(item.curSpi) + ' (+' + fmtSpi(item.delta) + ')');
  });
  lines.push('');
  lines.push('PROJETOS QUE PIORARAM (' + report.worsened.length + ')');
  if (!report.worsened.length) lines.push('  Nenhum.');
  report.worsened.forEach(function(item){
    lines.push('  - ' + item.project + ' (' + item.company + '): ' + fmtSpi(item.prevSpi) + ' -> ' + fmtSpi(item.curSpi) + ' (' + fmtSpi(item.delta) + ')');
  });
  if (report.onlyInCurrent.length){
    lines.push('');
    lines.push('PROJETOS NOVOS NESTA SEMANA (sem SPI anterior): ' + report.onlyInCurrent.map(function(d){ return d.project; }).join(', '));
  }
  if (report.onlyInPrevious.length){
    lines.push('');
    lines.push('PROJETOS DA SEMANA ANTERIOR NÃO PRESENTES NESTA SEMANA: ' + report.onlyInPrevious.map(function(d){ return d.project; }).join(', '));
  }
  lines.push('');
  lines.push('Gerado em ' + new Date().toLocaleString('pt-BR') + '.');
  return lines.join('\n');
}
/* ---------- geração do .xlsx do relatório (zip minimalista, sem bibliotecas externas) ---------- */
function xmlEscape(s){
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function colLetter(idx){
  var s = '';
  idx = idx + 1;
  while (idx > 0){
    var rem = (idx - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    idx = Math.floor((idx - 1) / 26);
  }
  return s;
}
function crc32(bytes){
  var table = crc32._table;
  if (!table){
    table = [];
    for (var n = 0; n < 256; n++){
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      table[n] = c >>> 0;
    }
    crc32._table = table;
  }
  var crc = 0xFFFFFFFF;
  for (var i = 0; i < bytes.length; i++) crc = (crc >>> 8) ^ table[(crc ^ bytes[i]) & 0xFF];
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
function dosDateTime(d){
  var year = Math.max(d.getFullYear(), 1980);
  var time = ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | (Math.floor(d.getSeconds() / 2) & 0x1F);
  var date = (((year - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0xF) << 5) | (d.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: date & 0xFFFF };
}
function u16le(n){ return [n & 0xFF, (n >>> 8) & 0xFF]; }
function u32le(n){ return [n & 0xFF, (n >>> 8) & 0xFF, (n >>> 16) & 0xFF, (n >>> 24) & 0xFF]; }
function makeZip(entries){
  var encoder = new TextEncoder();
  var chunks = [];
  var centralChunks = [];
  var offset = 0;
  var dt = dosDateTime(new Date());

  entries.forEach(function(entry){
    var nameBytes = encoder.encode(entry.name);
    var dataBytes = encoder.encode(entry.text);
    var crc = crc32(dataBytes);

    var local = [].concat(
      [0x50, 0x4B, 0x03, 0x04],
      u16le(20), u16le(0), u16le(0),
      u16le(dt.time), u16le(dt.date),
      u32le(crc), u32le(dataBytes.length), u32le(dataBytes.length),
      u16le(nameBytes.length), u16le(0)
    );
    var localHeader = new Uint8Array(local);
    chunks.push(localHeader, nameBytes, dataBytes);

    var central = [].concat(
      [0x50, 0x4B, 0x01, 0x02],
      u16le(20), u16le(20), u16le(0), u16le(0),
      u16le(dt.time), u16le(dt.date),
      u32le(crc), u32le(dataBytes.length), u32le(dataBytes.length),
      u16le(nameBytes.length), u16le(0), u16le(0),
      u16le(0), u16le(0), u32le(0),
      u32le(offset)
    );
    centralChunks.push(new Uint8Array(central), nameBytes);

    offset += localHeader.length + nameBytes.length + dataBytes.length;
  });

  var centralStart = offset;
  var centralSize = 0;
  centralChunks.forEach(function(c){ centralSize += c.length; });

  var end = new Uint8Array([].concat(
    [0x50, 0x4B, 0x05, 0x06],
    u16le(0), u16le(0),
    u16le(entries.length), u16le(entries.length),
    u32le(centralSize), u32le(centralStart),
    u16le(0)
  ));

  var all = chunks.concat(centralChunks, [end]);
  return new Blob(all, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function xlsxRow(rowIndex, values){
  var cells = values.map(function(v, i){
    var ref = colLetter(i) + rowIndex;
    if (v === null || v === undefined || v === '') return '<c r="' + ref + '"/>';
    return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + xmlEscape(v) + '</t></is></c>';
  }).join('');
  return '<row r="' + rowIndex + '">' + cells + '</row>';
}
function buildReportXlsxBlob(report){
  var rows = [];
  function addRow(cells){ rows.push(cells); }
  addRow(['RELATÓRIO SEMANAL — SPI']);
  addRow(['Semana atual', report.currentWeek]);
  addRow(['Semana anterior', report.previousWeek || '—']);
  addRow([]);
  if (report.globalDelta === null){
    addRow(['SPI global atual', report.curSpi !== null ? fmtSpi(report.curSpi) : '—']);
    addRow(['Observação', 'Sem semana anterior para comparar']);
  } else {
    var trend = report.globalDelta > SPI_EPSILON ? 'MELHOROU' : (report.globalDelta < -SPI_EPSILON ? 'PIOROU' : 'ESTÁVEL');
    addRow(['Indicador global', trend]);
    addRow(['SPI semana anterior', fmtSpi(report.prevSpi)]);
    addRow(['SPI semana atual', fmtSpi(report.curSpi)]);
    addRow(['Variação', (report.globalDelta > 0 ? '+' : '') + fmtSpi(report.globalDelta)]);
  }
  addRow([]);
  addRow(['Resumo', report.improved.length + ' melhoraram, ' + report.worsened.length + ' pioraram, ' + report.unchanged.length + ' sem mudança']);
  addRow([]);
  addRow(['Projetos que melhoraram (' + report.improved.length + ')']);
  addRow(['Projeto', 'Empresa', 'SPI anterior', 'SPI atual', 'Variação']);
  if (!report.improved.length) addRow(['Nenhum']);
  report.improved.forEach(function(item){
    addRow([item.project, item.company, fmtSpi(item.prevSpi), fmtSpi(item.curSpi), '+' + fmtSpi(item.delta)]);
  });
  addRow([]);
  addRow(['Projetos que pioraram (' + report.worsened.length + ')']);
  addRow(['Projeto', 'Empresa', 'SPI anterior', 'SPI atual', 'Variação']);
  if (!report.worsened.length) addRow(['Nenhum']);
  report.worsened.forEach(function(item){
    addRow([item.project, item.company, fmtSpi(item.prevSpi), fmtSpi(item.curSpi), fmtSpi(item.delta)]);
  });
  if (report.onlyInCurrent.length){
    addRow([]);
    addRow(['Projetos novos nesta semana (sem SPI anterior)']);
    report.onlyInCurrent.forEach(function(d){ addRow([d.project, d.company]); });
  }
  if (report.onlyInPrevious.length){
    addRow([]);
    addRow(['Projetos da semana anterior não presentes nesta semana']);
    report.onlyInPrevious.forEach(function(d){ addRow([d.project, d.company]); });
  }
  addRow([]);
  addRow(['Gerado em', new Date().toLocaleString('pt-BR')]);

  var sheetXml = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'];
  rows.forEach(function(cells, i){ sheetXml.push(xlsxRow(i + 1, cells)); });
  sheetXml.push('</sheetData></worksheet>');

  var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    '</Types>';
  var rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';
  var workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Relatório" sheetId="1" r:id="rId1"/></sheets></workbook>';
  var workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>';
  var styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  return makeZip([
    { name: '[Content_Types].xml', text: contentTypes },
    { name: '_rels/.rels', text: rootRels },
    { name: 'xl/workbook.xml', text: workbook },
    { name: 'xl/_rels/workbook.xml.rels', text: workbookRels },
    { name: 'xl/styles.xml', text: styles },
    { name: 'xl/worksheets/sheet1.xml', text: sheetXml.join('') }
  ]);
}
async function exportReport(){
  if (!lastReport) return;
  var xlsxFilename = 'relatorio-semanal-spi-' + lastReport.currentWeek + '.xlsx';

  // O recurso "downloads" do Artifact só libera uma lista fixa de extensões, e
  // .xlsx não está nela — então, quando o painel roda dentro dessa visualização,
  // caímos para o relatório em texto (sempre permitido) em vez do Excel.
  if (window.claude && typeof window.claude.use === 'function'){
    var downloads = null;
    try { downloads = await window.claude.use('downloads'); } catch (e) { downloads = null; }
    if (downloads && typeof downloads.save === 'function'){
      try {
        await downloads.save({ filename: 'relatorio-semanal-spi-' + lastReport.currentWeek + '.txt', data: buildReportText(lastReport) });
        showToast('Este modo de visualização não libera o formato Excel; o relatório foi exportado em texto.', 'warn');
      } catch (err) {
        if (!err || err.code !== 'declined'){
          showToast('Não foi possível exportar o relatório agora. Tente novamente em instantes.', 'error');
        }
      }
      return;
    }
  }

  var blob = buildReportXlsxBlob(lastReport);
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = xlsxFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  showToast('Relatório exportado em Excel (.xlsx).', '');
}
function openWeeklyReport(){
  if (!state.week){ showToast('Selecione uma semana para gerar o relatório.', 'warn'); return; }
  var prevWeek = previousWeekOf(state.week);
  var report = computeWeeklyComparison(state.week, prevWeek);
  renderWeeklyReport(report);
  var overlay = document.getElementById('reportOverlay');
  if (overlay) overlay.hidden = false;
}
function closeWeeklyReport(){
  var overlay = document.getElementById('reportOverlay');
  if (overlay) overlay.hidden = true;
}
function initWeeklyReport(){
  var btn = document.getElementById('btnWeeklyReport');
  if (btn) btn.addEventListener('click', openWeeklyReport);
  var closeBtn = document.getElementById('reportClose');
  if (closeBtn) closeBtn.addEventListener('click', closeWeeklyReport);
  var closeBtn2 = document.getElementById('reportCloseBtn');
  if (closeBtn2) closeBtn2.addEventListener('click', closeWeeklyReport);
  var exportBtn = document.getElementById('btnExportReport');
  if (exportBtn) exportBtn.addEventListener('click', exportReport);
  var overlay = document.getElementById('reportOverlay');
  if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) closeWeeklyReport(); });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && overlay && !overlay.hidden) closeWeeklyReport();
  });
}

function renderBandBreakdown(rows){
  var tbody = document.getElementById('bandBreakdownBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  var order = ['0-45%', '45-90%', '90%+'];
  order.forEach(function(band){
    var list = rows.filter(function(d){ return d.band === band; });
    var tr = document.createElement('tr');
    var tdB = document.createElement('td'); tdB.textContent = band; tr.appendChild(tdB);
    var tdN = document.createElement('td'); tdN.className = 'num'; tdN.textContent = list.length; tr.appendChild(tdN);
    tr.appendChild(spiCell(list));
    tbody.appendChild(tr);
  });
}
function renderCompanyBreakdown(rows){
  var tbody = document.getElementById('companyBreakdownBody');
  if (!tbody) return;
  tbody.innerHTML = '';
  var present = Array.from(new Set(rows.map(function(d){ return d.company; }))).sort();
  if (!present.length){
    var tr0 = document.createElement('tr');
    var td0 = document.createElement('td'); td0.colSpan = 3; td0.className = 'bd-empty'; td0.textContent = 'Nenhum projeto para esta seleção.';
    tr0.appendChild(td0); tbody.appendChild(tr0);
    return;
  }
  present.forEach(function(company){
    var list = rows.filter(function(d){ return d.company === company; });
    var tr = document.createElement('tr');

    var tdC = document.createElement('td'); tdC.textContent = company; tr.appendChild(tdC);

    var tdN = document.createElement('td'); tdN.className = 'num'; tdN.textContent = list.length; tr.appendChild(tdN);
    tr.appendChild(spiCell(list));
    tbody.appendChild(tr);
  });
}

/* ---------- main render ---------- */
function render(){
  var rows = currentRows();
  var svg = document.getElementById('chart');

  var idCount = document.getElementById('id-count');
  var idWeek = document.getElementById('id-week');
  if (idCount) idCount.textContent = rows.length;
  if (idWeek) idWeek.textContent = state.week || '—';

  var btnEmailHead = document.getElementById('btnEmailHead');
  if (btnEmailHead){
    var isolatedRow = state.isolatedProject ? rows.find(function(d){ return d.project === state.isolatedProject; }) : null;
    btnEmailHead.disabled = !isolatedRow;
    btnEmailHead.title = isolatedRow ? 'Enviar e-mail de acompanhamento de SPI para ' + projectLabel(isolatedRow) : 'Clique no nome de um projeto na tabela para selecioná-lo';
  }

  var withSpi = rows.filter(function(d){ return typeof d.spi === 'number' && d.pct_complete > 0; });
  // SPI Global = Σ Duração Base / Σ Duração Programada (ponderado pelo porte de cada
  // projeto, não a média simples dos SPIs individuais) — mesma fórmula da planilha de origem.
  var sumBase = rows.reduce(function(a, d){ return a + (Number(d.baseline_duration) || 0); }, 0);
  var sumSched = rows.reduce(function(a, d){ return a + (Number(d.schedule_duration) || 0); }, 0);
  var spiGlobal = sumSched > 0 ? sumBase / sumSched : 0;
  var good = rows.filter(function(d){ return d.pct_complete > 0 && statusOf(d.spi) === 'good'; }).length;
  var warn = rows.filter(function(d){ return d.pct_complete > 0 && statusOf(d.spi) === 'warn'; }).length;
  var crit = rows.filter(function(d){ return d.pct_complete > 0 && statusOf(d.spi) === 'crit'; }).length;
  var notStarted = rows.filter(function(d){ return d.pct_complete === 0; }).length;

  document.getElementById('kpiAvgSpi').textContent = sumSched > 0 ? fmtSpi(spiGlobal) : '—';
  document.getElementById('kpiAvgSpiSub').textContent = 'ponderado por duração · ' + rows.length + ' projeto(s)';
  document.getElementById('kpiGood').textContent = good;
  document.getElementById('kpiGoodSub').textContent = withSpi.length ? Math.round(good / withSpi.length * 100) + '% da seleção' : ' ';
  document.getElementById('kpiWarn').textContent = warn;
  document.getElementById('kpiWarnSub').textContent = withSpi.length ? Math.round(warn / withSpi.length * 100) + '% da seleção' : ' ';
  document.getElementById('kpiCrit').textContent = crit;
  var critParts = [];
  if (withSpi.length) critParts.push(Math.round(crit / withSpi.length * 100) + '% da seleção');
  if (notStarted) critParts.push(notStarted + ' ainda não iniciado(s)');
  document.getElementById('kpiCritSub').textContent = critParts.length ? critParts.join(' · ') : ' ';

  renderBandBreakdown(rows);
  renderCompanyBreakdown(rows);

  var chartRows = state.isolatedProject
    ? rows.filter(function(d){ return d.project === state.isolatedProject; })
    : rows;

  // por padrão o gráfico (SVG) fica visível e a grade de empresa escondida;
  // só o modo "histórico por empresa" em grade inverte isso, abaixo.
  var chartShellEl = document.getElementById('chartShell');
  var legendEl = document.getElementById('legend');
  var companyGridEl = document.getElementById('companyGrid');
  if (chartShellEl) chartShellEl.hidden = false;
  if (legendEl) legendEl.hidden = false;
  if (companyGridEl) companyGridEl.hidden = true;

  if (state.trendMode && state.isolatedProject){
    // modo "histórico": o gráfico principal vira uma linha de SPI por semana
    // do projeto isolado, em vez da dispersão por % concluído.
    hideTooltip();
    var trendRows = projectTrendRows(state.isolatedProject);
    updateChartHeading('project', state.isolatedProject, trendRows.length);
    buildTrendStaticChart(trendRows);
    drawTrendSeries(trendRows);
  } else if (state.companyGridView){
    // grade com uma mini-linha de SPI ao longo do tempo por projeto, para os
    // projetos da seleção atual de Empresa/Escopo. O filtro de status (Bom/
    // Atenção/Crítico) recorta quais projetos aparecem.
    hideTooltip();
    var gridData = filteredTrendGroups();
    var visibleGroups = gridData.groups.filter(function(g){ return state.companyStatusFilter[g.status]; });
    updateChartHeading('grid', null, visibleGroups.length);
    if (chartShellEl) chartShellEl.hidden = true;
    if (legendEl) legendEl.hidden = true;
    if (companyGridEl) companyGridEl.hidden = false;
    renderCompanyGrid({ weeks: gridData.weeks, groups: visibleGroups });
  } else {
    if (state.isolatedProject) updateChartHeading('isolated', state.isolatedProject);
    else updateChartHeading(null, null);
    buildStaticChart();

    // os botões de status (Bom/Atenção/Crítico) também recortam a dispersão:
    // desmarcar um deles esconde os pontos (e rótulos) daquele status aqui.
    var statusFilteredRows = chartRows.filter(function(d){ return state.companyStatusFilter[statusOf(d.spi)]; });

    // draw highest-SPI (safest) dots first, lowest-SPI (most critical) last, so
    // critical points render on top when markers overlap.
    var byRenderOrder = statusFilteredRows.slice().sort(function(a, b){ return b.spi - a.spi; });
    byRenderOrder.forEach(function(d){
      var cx = xScale(Math.min(Math.max(d.pct_complete, 0), 1));
      var cy = yScale(Math.min(Math.max(d.spi, yMin), yMax));
      var color = STATUS_COLOR[statusOf(d.spi)];
      var hit = el('circle', { class: 'dot-hit', cx: cx, cy: cy, r: 13, tabindex: '0', role: 'img',
        'aria-label': projectLabel(d) + ', ' + d.company + ', ' + fmtPct(d.pct_complete) + ' concluído, SPI ' + fmtSpi(d.spi) }, svg);
      el('circle', { class: 'dot-mark', cx: cx, cy: cy, r: 5, fill: color }, svg);
      hit.addEventListener('pointerenter', function(){ showTooltip(cx, cy, d); });
      hit.addEventListener('pointermove', function(){ showTooltip(cx, cy, d); });
      hit.addEventListener('pointerleave', hideTooltip);
      hit.addEventListener('focus', function(){ showTooltip(cx, cy, d); });
      hit.addEventListener('blur', hideTooltip);
      hit.addEventListener('click', function(){
        state.isolatedProject = d.project;
        state.trendMode = true;
        render();
      });
      hit.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' '){
          e.preventDefault();
          state.isolatedProject = d.project;
          state.trendMode = true;
          render();
        }
      });
    });

    // direct-label every point in the current selection, decluttered so long
    // project names don't stack on top of each other. Placed before the pinned
    // tooltip below so positionTooltip() can see the real label elements (and
    // steer clear of them) when it runs.
    placeDirectLabels(statusFilteredRows, svg);

    // when a single project is isolated, pin its tooltip open (no hover needed)
    // so the chart can be screenshotted/copied with the project's data visible —
    // e.g. to paste into an e-mail.
    if (state.isolatedProject && statusFilteredRows.length === 1){
      var iso = statusFilteredRows[0];
      var isoCx = xScale(Math.min(Math.max(iso.pct_complete, 0), 1));
      var isoCy = yScale(Math.min(Math.max(iso.spi, yMin), yMax));
      showTooltip(isoCx, isoCy, iso, true);
    } else {
      hideTooltip();
    }
  }

  var sorted = rows.slice().sort(function(a, b){
    var k = state.sortKey;
    var av = k === 'status' ? statusOf(a.spi) : a[k];
    var bv = k === 'status' ? statusOf(b.spi) : b[k];
    if (typeof av === 'string'){ av = av.toLowerCase(); bv = bv.toLowerCase(); }
    var cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return state.sortDir === 'asc' ? cmp : -cmp;
  });

  var tbody = document.getElementById('tableBody');
  tbody.innerHTML = '';
  if (!sorted.length){
    var tr0 = document.createElement('tr'); tr0.className = 'empty-row';
    var td0 = document.createElement('td'); td0.colSpan = isAdminUser() ? 7 : 6; td0.textContent = 'Nenhum lançamento para esta seleção.';
    tr0.appendChild(td0); tbody.appendChild(tr0);
  }
  sorted.forEach(function(d){
    var tr = document.createElement('tr');
    if (state.isolatedProject === d.project) tr.classList.add('row-isolated');

    var tdProj = document.createElement('td');
    var projLink = document.createElement('span');
    projLink.className = 'project-pick';
    projLink.textContent = projectLabel(d);
    projLink.tabIndex = 0;
    projLink.setAttribute('role', 'button');
    var isolating = state.isolatedProject === d.project;
    projLink.setAttribute('aria-pressed', isolating ? 'true' : 'false');
    projLink.setAttribute('aria-label', (isolating ? 'Remover destaque de ' : 'Mostrar apenas ') + projectLabel(d) + ' no gráfico');
    projLink.addEventListener('click', function(e){
      e.stopPropagation();
      state.isolatedProject = (state.isolatedProject === d.project) ? null : d.project;
      state.trendMode = false;
      render();
    });
    projLink.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' '){
        e.preventDefault(); e.stopPropagation();
        state.isolatedProject = (state.isolatedProject === d.project) ? null : d.project;
        state.trendMode = false;
        render();
      }
    });
    tdProj.appendChild(projLink); tr.appendChild(tdProj);

    var tdCo = document.createElement('td'); tdCo.textContent = d.company; tr.appendChild(tdCo);

    var tdScope = document.createElement('td'); tdScope.textContent = d.scope; tr.appendChild(tdScope);
    var tdPct = document.createElement('td'); tdPct.className = 'num'; tdPct.textContent = fmtPct(d.pct_complete); tr.appendChild(tdPct);
    var tdSpi = document.createElement('td'); tdSpi.className = 'num'; tdSpi.textContent = fmtSpi(d.spi); tr.appendChild(tdSpi);

    var tdStatus = document.createElement('td');
    var st = statusOf(d.spi);
    var pill = document.createElement('span'); pill.className = 'status-pill ' + st;
    pill.textContent = statusLabel[st] + ' · ' + statusRange[st];
    tdStatus.appendChild(pill); tr.appendChild(tdStatus);

    if (isAdminUser()){
      var tdActions = document.createElement('td');
      var excludeBtn = document.createElement('button');
      excludeBtn.type = 'button';
      excludeBtn.className = 'btn ghost small exclude-row';
      excludeBtn.textContent = 'Excluir projeto';
      excludeBtn.title = 'Remove "' + d.project + '" do painel em todas as semanas (reversível em "Projetos excluídos")';
      excludeBtn.addEventListener('click', function(e){
        e.stopPropagation();
        openExcludeConfirm(d.project);
      });
      tdActions.appendChild(excludeBtn);
      tr.appendChild(tdActions);

      tr.classList.add('clickable');
      tr.tabIndex = 0;
      tr.setAttribute('role', 'button');
      tr.setAttribute('aria-label', 'Editar lançamento de ' + projectLabel(d));
      tr.addEventListener('click', function(){ openModal('edit', d); });
      tr.addEventListener('keydown', function(e){
        if (e.key === 'Enter' || e.key === ' '){ e.preventDefault(); openModal('edit', d); }
      });
    }

    tbody.appendChild(tr);
  });

  Array.from(document.querySelectorAll('thead th[data-key]')).forEach(function(th){
    th.querySelectorAll('.arrow').forEach(function(a){ a.remove(); });
    if (th.dataset.key === state.sortKey){
      var arrow = document.createElement('span'); arrow.className = 'arrow';
      arrow.textContent = state.sortDir === 'asc' ? '▲' : '▼';
      th.appendChild(arrow);
    }
  });
}

/* ---------- add / edit modal ---------- */
function openModal(mode, row){
  editingKey = mode === 'edit' ? row.rowKey : null;
  editingRow = mode === 'edit' ? row : null;
  document.getElementById('modalTitle').textContent = mode === 'edit' ? 'Edit entry' : 'New entry';
  var errEl = document.getElementById('formError'); errEl.classList.remove('show'); errEl.textContent = '';
  var f = document.getElementById('entryForm'); f.reset();

  if (mode === 'edit'){
    document.getElementById('fCode').value = row.id || '';
    document.getElementById('fProject').value = row.project;
    document.getElementById('fCompany').value = row.company;
    document.getElementById('fScope').value = row.scope;
    document.getElementById('fWeek').value = inputValueFromWeekLabel(row.week);
    document.getElementById('fCr').value = row.cr;
    document.getElementById('fBaseline').value = row.baseline_duration;
    document.getElementById('fVariance').value = row.finish_variance;
    document.getElementById('fPct').value = Math.round(row.pct_complete * 100);
    document.getElementById('fPmEmail').value = row.pm_email || pmEmailForProject(row.project) || '';
    var fPmNameEdit = document.getElementById('fPmName');
    if (fPmNameEdit) fPmNameEdit.value = row.pm_name || pmNameForProject(row.project) || '';
  } else {
    document.getElementById('fWeek').value = inputValueFromWeekLabel(state.week);
    document.getElementById('fCr').value = 0;
    document.getElementById('fVariance').value = 0;
    if (state.companies.size === 1) document.getElementById('fCompany').value = Array.from(state.companies)[0];
    if (state.scopes.size === 1) document.getElementById('fScope').value = Array.from(state.scopes)[0];
  }
  var delBtn = document.getElementById('btnDelete');
  resetDeleteButton();
  delBtn.hidden = mode !== 'edit';
  delBtn.disabled = false;

  updatePreview();
  document.getElementById('modalOverlay').hidden = false;
  document.getElementById('fProject').focus();
}
function closeModal(){
  document.getElementById('modalOverlay').hidden = true;
  editingKey = null;
  editingRow = null;
  resetDeleteButton();
}
function setFormBusy(b){
  document.getElementById('btnSave').disabled = b;
  document.getElementById('btnCancel').disabled = b;
  document.getElementById('btnDelete').disabled = b;
}

var deleteConfirming = false;
var deleteTimer = null;
function resetDeleteButton(){
  deleteConfirming = false;
  clearTimeout(deleteTimer);
  var b = document.getElementById('btnDelete');
  b.textContent = 'Excluir lançamento';
  b.classList.remove('danger'); b.classList.add('danger-outline');
}
function updatePreview(){
  var base = parseFloat(document.getElementById('fBaseline').value) || 0;
  var variance = parseFloat(document.getElementById('fVariance').value) || 0;
  var sched = base + variance;
  var spi = sched > 0 ? base / sched : 0;
  var pct = Math.max(0, Math.min(100, parseFloat(document.getElementById('fPct').value) || 0)) / 100;
  document.getElementById('prevSched').textContent = sched.toFixed(1) + ' d';
  document.getElementById('prevSpi').textContent = fmtSpi(spi);
  document.getElementById('prevBand').textContent = bandOf(pct);
}

function initFormListeners(){
  ['fBaseline', 'fVariance', 'fPct'].forEach(function(id){
    document.getElementById(id).addEventListener('input', updatePreview);
  });
  // auto-fill the PM e-mail from an existing entry of the same project, so
  // it only has to be typed once per project.
  var fProject = document.getElementById('fProject');
  if (fProject) fProject.addEventListener('change', function(){
    if (editingKey) return;
    var fPmEmail = document.getElementById('fPmEmail');
    if (fPmEmail && !fPmEmail.value.trim()){
      var known = pmEmailForProject(fProject.value.trim());
      if (known) fPmEmail.value = known;
    }
    var fPmName = document.getElementById('fPmName');
    if (fPmName && !fPmName.value.trim()){
      var knownName = pmNameForProject(fProject.value.trim());
      if (knownName) fPmName.value = knownName;
    }
  });
  var fCode = document.getElementById('fCode');
  if (fCode) fCode.addEventListener('change', function(){
    if (editingKey) return;
    var code = fCode.value.trim();
    if (!code) return;
    var match = DATA.find(function(d){ return d.id === code; });
    if (match){
      document.getElementById('fProject').value = match.project;
      document.getElementById('fCompany').value = match.company;
      document.getElementById('fScope').value = match.scope;
      var fPmEmail = document.getElementById('fPmEmail');
      if (fPmEmail && !fPmEmail.value.trim() && match.pm_email) fPmEmail.value = match.pm_email;
      var fPmName = document.getElementById('fPmName');
      if (fPmName && !fPmName.value.trim() && match.pm_name) fPmName.value = match.pm_name;
    }
  });
  var btnAdd = document.getElementById('btnAdd');
  if (btnAdd) btnAdd.addEventListener('click', function(){ openModal('add'); });
  var btnAdvanceWeek = document.getElementById('btnAdvanceWeek');
  if (btnAdvanceWeek) btnAdvanceWeek.addEventListener('click', advanceWeek);
  var btnDeleteWeek = document.getElementById('btnDeleteWeek');
  if (btnDeleteWeek) btnDeleteWeek.addEventListener('click', btnDeleteWeekClick);
  var btnExportData = document.getElementById('btnExportData');
  if (btnExportData) btnExportData.addEventListener('click', exportData);
  var btnImportData = document.getElementById('btnImportData');
  var importFileInput = document.getElementById('importFileInput');
  if (btnImportData && importFileInput){
    btnImportData.addEventListener('click', function(){ importFileInput.click(); });
    importFileInput.addEventListener('change', function(){
      if (importFileInput.files && importFileInput.files[0]) importDataFromFile(importFileInput.files[0]);
      importFileInput.value = '';
    });
  }
  var btnEmailHead = document.getElementById('btnEmailHead');
  if (btnEmailHead) btnEmailHead.addEventListener('click', function(){
    if (!state.isolatedProject) return;
    var row = currentRows().find(function(d){ return d.project === state.isolatedProject; });
    if (row) openEmailConfirm(row);
  });
  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('btnCancel').addEventListener('click', closeModal);
  document.getElementById('modalOverlay').addEventListener('click', function(e){
    if (e.target === document.getElementById('modalOverlay')) closeModal();
  });
  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && !document.getElementById('modalOverlay').hidden) closeModal();
  });

  document.getElementById('btnDelete').addEventListener('click', async function(){
    if (!editingKey) return;
    var btn = document.getElementById('btnDelete');
    if (!deleteConfirming){
      deleteConfirming = true;
      btn.textContent = 'Confirmar exclusão';
      btn.classList.remove('danger-outline'); btn.classList.add('danger');
      deleteTimer = setTimeout(resetDeleteButton, 3500);
      return;
    }
    clearTimeout(deleteTimer);
    setFormBusy(true);
    var newData = DATA.filter(function(d){ return d.rowKey !== editingKey; });
    var ok = await persistData(newData);
    setFormBusy(false);
    if (ok){
      resetDeleteButton();
      recomputeDerivedLists();
      refreshFilterUI();
      closeModal();
      render();
      showToast('Lançamento excluído.', '');
    } else {
      resetDeleteButton();
    }
  });

  document.getElementById('entryForm').addEventListener('submit', async function(e){
    e.preventDefault();

    var code = document.getElementById('fCode').value.trim();
    var project = document.getElementById('fProject').value.trim();
    var company = document.getElementById('fCompany').value.trim();
    var scope = document.getElementById('fScope').value.trim();
    var weekLabel = weekLabelFromInputValue(document.getElementById('fWeek').value);
    var cr = parseFloat(document.getElementById('fCr').value) || 0;
    var base = parseFloat(document.getElementById('fBaseline').value);
    var variance = parseFloat(document.getElementById('fVariance').value) || 0;
    var pctRaw = parseFloat(document.getElementById('fPct').value);
    var pmEmail = document.getElementById('fPmEmail').value.trim();
    var pmNameEl = document.getElementById('fPmName');
    var pmName = pmNameEl ? pmNameEl.value.trim() : '';

    var errEl = document.getElementById('formError');
    if (!code || !project || !company || !scope || !weekLabel || isNaN(base) || base < 0 || isNaN(pctRaw)){
      errEl.textContent = 'Fill in project code, project, company, scope, week (format YYYY-Www), baseline duration and % complete.';
      errEl.classList.add('show');
      return;
    }
    errEl.classList.remove('show');

    // impede lançamento duplicado: já existe um registro para a mesma
    // empresa/projeto/escopo/semana? (ignora o próprio registro, se estiver
    // editando um já existente).
    var duplicate = DATA.some(function(d){
      return d.rowKey !== editingKey && d.company === company && d.project === project &&
        d.scope === scope && d.week === weekLabel;
    });
    if (duplicate){
      errEl.textContent = 'Já existe um lançamento para "' + project + '" (' + scope + ') na semana ' + weekLabel + '. Edite o lançamento existente em vez de criar um novo.';
      errEl.classList.add('show');
      return;
    }

    var sched = base + variance;
    var spi = sched > 0 ? base / sched : 0;
    var pct = Math.max(0, Math.min(100, pctRaw)) / 100;

    var rowKey = editingKey || newRowKey();
    var id = code;

    var row = {
      rowKey: rowKey, id: id, company: company, project: project, scope: scope,
      cr: cr, baseline_duration: round4(base), finish_variance: round4(variance),
      schedule_duration: round4(sched), spi: round4(spi),
      week: weekLabel, date: dateFromWeekLabel(weekLabel),
      pct_complete: round4(pct), band: bandOf(pct), pm_email: pmEmail, pm_name: pmName
    };

    var newData = editingKey ? DATA.map(function(d){ return d.rowKey === editingKey ? row : d; }) : DATA.concat([row]);
    var wasEditing = !!editingKey;

    setFormBusy(true);
    var ok = await persistData(newData);
    setFormBusy(false);
    if (ok){
      recomputeDerivedLists();
      refreshFilterUI();
      closeModal();
      render();
      showToast(wasEditing ? 'Lançamento atualizado.' : 'Lançamento adicionado.', '');
    }
  });
}

/* ---------- table sort header ---------- */
function initSortHeaders(){
  Array.from(document.querySelectorAll('thead th[data-key]')).forEach(function(th){
    th.addEventListener('click', function(){
      var key = th.dataset.key;
      if (state.sortKey === key){ state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc'; }
      else { state.sortKey = key; state.sortDir = 'asc'; }
      render();
    });
  });
}

/* ---------- week select ---------- */
function populateWeekOptions(){
  var sel = document.getElementById('weekSelect');
  if (!sel) return;
  sel.innerHTML = '';
  weeks.forEach(function(w){
    var opt = document.createElement('option'); opt.value = w; opt.textContent = w;
    sel.appendChild(opt);
  });
  sel.value = state.week || '';
}
function initWeekSelect(){
  var sel = document.getElementById('weekSelect');
  populateWeekOptions();
  sel.addEventListener('change', function(){ state.week = sel.value; render(); });
}

/* ---------- theme ---------- */
function getSystemTheme(){
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function currentTheme(){
  var attr = document.documentElement.getAttribute('data-theme');
  return attr || getSystemTheme();
}
function updateThemeToggleLabel(){
  var btn = document.getElementById('themeToggle');
  if (!btn) return;
  btn.textContent = currentTheme() === 'dark' ? 'Modo claro' : 'Modo escuro';
}
function initTheme(){
  updateThemeToggleLabel();
  var btn = document.getElementById('themeToggle');
  if (btn){
    btn.addEventListener('click', function(){
      var next = currentTheme() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      updateThemeToggleLabel();
      buildStaticChart();
      render();
    });
  }
}

/* ---------- boot ---------- */
async function boot(){
  initTheme();
  buildStaticChart();
  renderLegend();
  initEmailConfirm();
  initExcludeConfirm();
  initAdvanceConfirm();
  initDeleteWeekConfirm();
  initTrendMode();

  await loadData();
  if (currentUserCompanyScope){
    DATA = DATA.filter(function(d){ return d.company === currentUserCompanyScope; });
  }
  await loadExcluded();
  recomputeDerivedLists();

  populateDatalists();
  buildPills(document.getElementById('companyPills'), companies, state.companies, null);
  buildPills(document.getElementById('scopePills'), scopes, state.scopes, null);
  initWeekSelect();
  initSortHeaders();
  initFormListeners();
  initExcludedModal();
  initWeeklyReport();
  updateExcludedButtonLabel();
  render();
  if (!supabaseClient && isAdminUser()){
    showToast('Supabase não configurado (config.js) — as alterações valem só para esta visualização.', 'warn');
  }
}
initLogin();
