// Lógica do Dashboard SPI (mesmas regras do site spi-supabase-1):
// SPI ponderado = Σ baseline ÷ Σ duração do schedule; faixas Bom > 1,00 · Atenção 0,85–1,00 · Crítico < 0,85;
// projetos excluídos somem de todas as semanas; encerrados somem da semana de encerramento em diante.
export const BANDS = ['0-45%', '45-90%', '90%+'];
export function statusOf(spi) { return spi > 1 ? 'Bom' : (spi >= 0.85 ? 'Atenção' : 'Crítico'); }
export function weighted(list) {
  let b = 0, s = 0;
  for (const d of list) { b += Number(d.baseline_duration) || 0; s += Number(d.schedule_duration) || 0; }
  return s > 0 ? b / s : null;
}
const r3 = (v) => v === null || v === undefined ? null : Math.round(v * 1000) / 1000;
const r1 = (v) => v === null || v === undefined ? null : Math.round(v * 10) / 10;
const pct = (v) => v === null || v === undefined ? null : Math.round(Number(v) * 100);
const norm = (t) => String(t || '').trim().toLowerCase();

export function prepare(rows, state) {
  const excluded = new Set((state && state.excluded_projects) || []);
  const ended = (state && state.ended_projects) || {};
  const data = rows.filter((d) => !excluded.has(d.project) && !(ended[d.project] && d.week >= ended[d.project]));
  const weeks = [...new Set(data.map((d) => d.week))].sort();
  return { data, weeks, published: (state && state.published_week) || null };
}
export function resolveWeek(ctx, week, onlyPublished) {
  let weeks = ctx.weeks;
  if (onlyPublished && ctx.published) weeks = weeks.filter((w) => w <= ctx.published);
  if (!weeks.length) throw new Error('Nenhuma semana com lançamentos.');
  if (!week) return weeks[weeks.length - 1];
  const w = String(week).trim();
  if (weeks.includes(w)) return w;
  // aceita data (AAAA-MM-DD ou MM/DD/AAAA): semana cujo lançamento tem essa data de referência
  const iso = /^(\d{2})\/(\d{2})\/(\d{4})$/.test(w) ? w.replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$1-$2') : w;
  const hit = ctx.data.find((d) => d.date === iso);
  if (hit && weeks.includes(hit.week)) return hit.week;
  throw new Error('Semana "' + w + '" não encontrada. Semanas disponíveis: ' + weeks.slice(-8).join(', ') + ' (use listar_semanas para todas).');
}
export function prevWeek(ctx, week) { const i = ctx.weeks.indexOf(week); return i > 0 ? ctx.weeks[i - 1] : null; }
export function filterRows(ctx, week, f) {
  f = f || {};
  return ctx.data.filter((d) => d.week === week
    && (!f.empresa || norm(d.company) === norm(f.empresa))
    && (!f.escopo || norm(d.scope) === norm(f.escopo)));
}
export function refDate(list) {
  const c = {}; let ref = '';
  for (const d of list) if (d.date) { c[d.date] = (c[d.date] || 0) + 1; if (!ref || c[d.date] > c[ref]) ref = d.date; }
  return ref || null;
}
function delta(a, b) { return a !== null && b !== null ? r3(a - b) : null; }

export function listWeeks(ctx, f) {
  return ctx.weeks.map((w) => {
    const l = filterRows(ctx, w, f); const g = weighted(l);
    return { semana: w, data_referencia: refDate(l), projetos: l.length, spi_global: r3(g), status: g === null ? null : statusOf(g), publicada: ctx.published ? w <= ctx.published : null };
  }).filter((x) => x.projetos > 0);
}
export function byBand(ctx, week, f) {
  const pw = prevWeek(ctx, week);
  const cur = filterRows(ctx, week, f), prev = pw ? filterRows(ctx, pw, f) : [];
  const prevBy = Object.fromEntries(prev.map((d) => [d.project, d]));
  const changes = cur.filter((d) => prevBy[d.project] && prevBy[d.project].band && d.band && prevBy[d.project].band !== d.band)
    .map((d) => ({ projeto: d.project, empresa: d.company, de: prevBy[d.project].band, para: d.band }));
  const faixas = BANDS.map((b) => {
    const c = cur.filter((d) => d.band === b), p = prev.filter((d) => d.band === b);
    const cs = weighted(c), ps = pw ? weighted(p) : null;
    return { faixa: b, projetos: c.length, spi: r3(cs), status: cs === null ? null : statusOf(cs), projetos_semana_anterior: pw ? p.length : null, spi_semana_anterior: r3(ps), variacao: delta(cs, ps),
      entraram: changes.filter((x) => x.para === b).map((x) => x.projeto), sairam: changes.filter((x) => x.de === b).map((x) => x.projeto),
      lista: c.map((d) => ({ projeto: d.project, empresa: d.company, spi: r3(Number(d.spi)), pct_fisico: pct(d.pct_complete) })).sort((a, z) => a.spi - z.spi) };
  });
  const g = weighted(cur);
  return { semana: week, semana_anterior: pw, data_referencia: refDate(cur), spi_global: r3(g), faixas, mudaram_de_faixa: changes };
}
export function byCompany(ctx, week, f) {
  const pw = prevWeek(ctx, week);
  const cur = filterRows(ctx, week, { escopo: f && f.escopo }), prev = pw ? filterRows(ctx, pw, { escopo: f && f.escopo }) : [];
  const cos = [...new Set(cur.map((d) => d.company))].sort();
  const empresas = cos.map((co) => {
    const c = cur.filter((d) => d.company === co), p = prev.filter((d) => d.company === co);
    const cs = weighted(c), ps = pw ? weighted(p) : null;
    return { empresa: co, projetos: c.length, spi: r3(cs), status: cs === null ? null : statusOf(cs), spi_semana_anterior: r3(ps), variacao: delta(cs, ps),
      bom: c.filter((d) => Number(d.pct_complete) > 0 && statusOf(Number(d.spi)) === 'Bom').length,
      atencao: c.filter((d) => Number(d.pct_complete) > 0 && statusOf(Number(d.spi)) === 'Atenção').length,
      critico: c.filter((d) => Number(d.pct_complete) > 0 && statusOf(Number(d.spi)) === 'Crítico').length,
      nao_iniciados: c.filter((d) => Number(d.pct_complete) === 0).length };
  });
  const g = weighted(cur), gp = pw ? weighted(prev) : null;
  return { semana: week, semana_anterior: pw, data_referencia: refDate(cur), spi_global: r3(g), spi_global_semana_anterior: r3(gp), variacao_global: delta(g, gp), empresas };
}
export function projectsWeek(ctx, week, f) {
  f = f || {};
  const pw = prevWeek(ctx, week);
  const cur = filterRows(ctx, week, f), prev = pw ? filterRows(ctx, pw, f) : [];
  const prevBy = Object.fromEntries(prev.map((d) => [d.project, d]));
  let list = cur.map((d) => {
    const p = prevBy[d.project]; const spi = Number(d.spi);
    return { projeto: d.project, empresa: d.company, escopo: d.scope, spi: r3(spi), status: statusOf(spi), pct_fisico: pct(d.pct_complete), faixa: d.band,
      baseline_dias: r1(Number(d.baseline_duration)), schedule_dias: r1(Number(d.schedule_duration)), atraso_termino_dias: r1(Number(d.finish_variance)),
      spi_semana_anterior: p ? r3(Number(p.spi)) : null, variacao_spi: p ? r3(spi - Number(p.spi)) : null,
      variacao_pct_fisico_pp: p ? pct(d.pct_complete) - pct(p.pct_complete) : null,
      variacao_termino_dias: p ? r1(Number(d.schedule_duration) - Number(p.schedule_duration)) : null,
      novo_na_semana: !p, cr: d.cr || 0, pm: d.pm_name || null, pm_email: d.pm_email || null, data_referencia: d.date };
  });
  const contagem = { bom: list.filter((x) => x.status === 'Bom').length, atencao: list.filter((x) => x.status === 'Atenção').length, critico: list.filter((x) => x.status === 'Crítico').length };
  if (f.status) list = list.filter((x) => norm(x.status) === norm(f.status).replace('atencao', 'atenção').replace('critico', 'crítico'));
  if (f.projeto) list = list.filter((x) => norm(x.projeto).includes(norm(f.projeto)));
  const ord = f.ordenar || 'spi';
  const key = { spi: (x) => x.spi, pct_fisico: (x) => -x.pct_fisico, atraso: (x) => -x.atraso_termino_dias, variacao: (x) => x.variacao_spi === null ? 99 : x.variacao_spi, nome: null }[ord];
  list.sort(key ? (a, b) => key(a) - key(b) : (a, b) => a.projeto.localeCompare(b.projeto));
  const g = weighted(cur);
  return { semana: week, semana_anterior: pw, data_referencia: refDate(cur), spi_global: r3(g), status_global: g === null ? null : statusOf(g),
    total_projetos: cur.length, contagem, filtro_status: f.status || null, projetos_listados: list.length,
    sairam_desde_semana_anterior: prev.filter((d) => !cur.some((c) => c.project === d.project)).map((d) => d.project), projetos: list };
}
export function globalEvolution(ctx, f) {
  f = f || {};
  let weeks = ctx.weeks;
  if (f.de) weeks = weeks.filter((w) => w >= f.de);
  if (f.ate) weeks = weeks.filter((w) => w <= f.ate);
  const out = [];
  for (const w of weeks) {
    const l = filterRows(ctx, w, f); if (!l.length) continue;
    const g = weighted(l); const prev = out.length ? out[out.length - 1].spi_global : null;
    out.push({ semana: w, data_referencia: refDate(l), projetos: l.length, spi_global: r3(g), status: statusOf(g), variacao: prev === null ? null : r3(g - prev) });
  }
  const vals = out.map((x) => x.spi_global);
  return { filtro: { empresa: f.empresa || 'todas', escopo: f.escopo || 'todos' }, semanas: out,
    resumo: out.length ? { primeira: out[0], ultima: out[out.length - 1], maior: out.reduce((a, b) => (b.spi_global > a.spi_global ? b : a)), menor: out.reduce((a, b) => (b.spi_global < a.spi_global ? b : a)),
      variacao_total: r3(vals[vals.length - 1] - vals[0]) } : null };
}
export function projectHistory(ctx, name) {
  const n = norm(name);
  const names = [...new Set(ctx.data.map((d) => d.project))];
  const exact = names.find((x) => norm(x) === n);
  const hits = exact ? [exact] : names.filter((x) => norm(x).includes(n));
  if (!hits.length) throw new Error('Projeto "' + name + '" não encontrado.');
  if (hits.length > 1) return { ambiguo: true, projetos_encontrados: hits };
  const rows = ctx.data.filter((d) => d.project === hits[0]).sort((a, b) => (a.week < b.week ? -1 : 1));
  return { projeto: hits[0], empresa: rows[0].company, escopo: rows[0].scope, historico: rows.map((d) => ({ semana: d.week, data_referencia: d.date, spi: r3(Number(d.spi)), status: statusOf(Number(d.spi)), pct_fisico: pct(d.pct_complete), atraso_termino_dias: r1(Number(d.finish_variance)) })) };
}
