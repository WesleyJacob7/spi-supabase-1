// MCP do Dashboard SPI (JKA / Prestige) — lê os dados direto do Supabase do painel (spi_records + app_state).
// Mesmas regras do site: SPI ponderado = Σ baseline ÷ Σ duração do schedule; projetos excluídos/encerrados ficam de fora.
// Acesso: URL com ?key=<SPI_MCP_KEY> (ou header x-api-key).
import 'jsr:@supabase/functions-js/edge-runtime.d.ts'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js'
import { Hono } from 'npm:hono@^4.9.7'
import { z } from 'npm:zod@^4.1.13'
import { createClient } from 'npm:@supabase/supabase-js@2'
import * as L from './logic.js'

const sb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

async function loadCtx() {
  const rows: any[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from('spi_records')
      .select('project,company,scope,cr,baseline_duration,schedule_duration,finish_variance,spi,week,date,pct_complete,band,pm_name,pm_email')
      .order('week').order('project').range(from, from + 999)
    if (error) throw new Error('Erro lendo spi_records: ' + error.message)
    rows.push(...data)
    if (data.length < 1000) break
  }
  const { data: st, error: e2 } = await sb.from('app_state').select('excluded_projects,ended_projects,published_week').eq('id', 'global').maybeSingle()
  if (e2) throw new Error('Erro lendo app_state: ' + e2.message)
  return L.prepare(rows, st || {})
}
const ok = (obj: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(obj) }] })
const fail = (e: unknown) => ({ isError: true, content: [{ type: 'text' as const, text: String((e as Error)?.message || e) }] })
const RO = { readOnlyHint: true, openWorldHint: false }
const semana = z.string().optional().describe('Semana no formato AAAA-SS (ex.: 2026-45) ou a data de referência (AAAA-MM-DD ou MM/DD/AAAA). Padrão: semana mais recente.')
const somentePub = z.boolean().optional().describe('true = considerar só semanas já publicadas para JKA/Prestige (corte do botão "Publicar semana"). Padrão: false (inclui a semana em conferência).')
const empresa = z.string().optional().describe('Filtrar por empresa: JKA ou Prestige. Vazio = todas.')
const escopo = z.string().optional().describe('Filtrar por escopo (ex.: Framing, Siding). Vazio = todos.')

function buildServer() {
  const server = new McpServer({ name: 'dashboard-spi', version: '1.0.0' }, {
    instructions: 'Dados do Dashboard SPI (Avalon Homes — JKA e Prestige). SPI = índice de desempenho de prazo, ponderado por duração (Σ baseline ÷ Σ duração do schedule). Faixas: Bom > 1,00 · Atenção 0,85–1,00 · Crítico < 0,85. Semanas no formato AAAA-SS; datas de referência em AAAA-MM-DD. Comece por listar_semanas se não souber qual semana usar.'
  })
  server.registerTool('listar_semanas', {
    title: 'Listar semanas', annotations: RO,
    description: 'Lista as semanas com lançamentos no Dashboard SPI, com data de referência, nº de projetos, SPI Global e se a semana já foi publicada para JKA/Prestige.',
    inputSchema: { empresa, escopo },
  }, async (a) => { try { const ctx = await loadCtx(); return ok({ semana_publicada: ctx.published, semanas: L.listWeeks(ctx, a) }) } catch (e) { return fail(e) } })

  server.registerTool('spi_por_faixa_fisico', {
    title: 'SPI por % físico concluído', annotations: RO,
    description: 'SPI ponderado por faixa de % físico concluído (0-45%, 45-90%, 90%+) na semana, com comparação com a semana anterior, projetos que entraram/saíram de cada faixa e a lista de projetos de cada faixa.',
    inputSchema: { semana, empresa, escopo, somente_publicadas: somentePub },
  }, async (a) => { try { const ctx = await loadCtx(); const w = L.resolveWeek(ctx, a.semana, a.somente_publicadas); return ok(L.byBand(ctx, w, a)) } catch (e) { return fail(e) } })

  server.registerTool('spi_por_empresa', {
    title: 'SPI por empresa', annotations: RO,
    description: 'SPI ponderado por empresa (JKA, Prestige) na semana, com variação contra a semana anterior e contagem de projetos Bom / Atenção / Crítico / não iniciados; inclui o SPI Global.',
    inputSchema: { semana, escopo, somente_publicadas: somentePub },
  }, async (a) => { try { const ctx = await loadCtx(); const w = L.resolveWeek(ctx, a.semana, a.somente_publicadas); return ok(L.byCompany(ctx, w, a)) } catch (e) { return fail(e) } })

  server.registerTool('projetos_semana', {
    title: 'Projetos — semana selecionada', annotations: RO,
    description: 'Tabela de projetos da semana: SPI, status, % físico, faixa, baseline, duração do schedule, atraso no término, variação contra a semana anterior (SPI, p.p. de avanço, dias de término) e PM. Filtros por empresa, escopo, status e nome do projeto.',
    inputSchema: {
      semana, empresa, escopo, somente_publicadas: somentePub,
      status: z.enum(['Bom', 'Atenção', 'Crítico']).optional().describe('Filtrar por status do SPI.'),
      projeto: z.string().optional().describe('Trecho do nome do projeto para filtrar.'),
      ordenar: z.enum(['spi', 'pct_fisico', 'atraso', 'variacao', 'nome']).optional().describe('Ordenação: spi (menor primeiro, padrão), pct_fisico, atraso (maior primeiro), variacao (maior queda primeiro) ou nome.'),
    },
  }, async (a) => { try { const ctx = await loadCtx(); const w = L.resolveWeek(ctx, a.semana, a.somente_publicadas); return ok(L.projectsWeek(ctx, w, a)) } catch (e) { return fail(e) } })

  server.registerTool('evolucao_spi_global', {
    title: 'Evolução do SPI Global', annotations: RO,
    description: 'Série semanal do SPI Global ponderado (todas as empresas ou uma empresa/escopo), com variação semana a semana e resumo (primeira, última, maior, menor e variação total).',
    inputSchema: {
      empresa, escopo,
      de: z.string().optional().describe('Semana inicial AAAA-SS (inclusive).'),
      ate: z.string().optional().describe('Semana final AAAA-SS (inclusive).'),
    },
  }, async (a) => { try { const ctx = await loadCtx(); return ok(L.globalEvolution(ctx, a)) } catch (e) { return fail(e) } })

  server.registerTool('historico_projeto', {
    title: 'Histórico de um projeto', annotations: RO,
    description: 'Histórico semanal de SPI, status, % físico e atraso no término de um projeto (busca pelo nome ou parte dele).',
    inputSchema: { projeto: z.string().describe('Nome do projeto ou parte dele (ex.: "Mary Ellen", "247").') },
  }, async (a) => { try { const ctx = await loadCtx(); return ok(L.projectHistory(ctx, a.projeto)) } catch (e) { return fail(e) } })
  return server
}

// chaves de acesso: tabela privada spi_mcp_access (RLS sem políticas — só a função, com service role, lê) ou env SPI_MCP_KEY
let keyCache: { at: number, keys: Set<string> } | null = null
async function validKey(k: string) {
  const env = Deno.env.get('SPI_MCP_KEY')
  if (env && k === env) return true
  if (!keyCache || Date.now() - keyCache.at > 60000) {
    const { data } = await sb.from('spi_mcp_access').select('key').eq('active', true)
    keyCache = { at: Date.now(), keys: new Set((data || []).map((r: any) => r.key)) }
  }
  return keyCache.keys.has(k)
}
const app = new Hono().basePath('/spi-mcp')
app.use('*', async (c, next) => {
  if (c.req.method === 'OPTIONS') return new Response(null, { headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS' } })
  const given = c.req.query('key') || c.req.header('x-api-key') || ''
  if (!given || !(await validKey(given))) return c.json({ error: 'unauthorized' }, 401)
  await next()
  c.res.headers.set('access-control-allow-origin', '*')
})
app.all('*', async (c) => {
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await buildServer().connect(transport)
  return transport.handleRequest(c.req.raw)
})
Deno.serve(app.fetch)
