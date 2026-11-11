# spi-mcp — MCP do Dashboard SPI

Edge Function do Supabase (projeto dashboard-spi) que expõe os dados do painel como servidor MCP (Streamable HTTP), para usar como conector no Claude.

- URL: `https://dxgdhjehgctlmvrgaets.supabase.co/functions/v1/spi-mcp/mcp?key=<chave>`
- Chaves de acesso: tabela privada `spi_mcp_access` (coluna `active` desliga uma chave).
- Somente leitura. Mesmas regras do site: SPI ponderado = Σ baseline ÷ Σ duração do schedule; excluídos/encerrados ficam de fora.

Ferramentas: `listar_semanas`, `spi_por_faixa_fisico`, `spi_por_empresa`, `projetos_semana`, `evolucao_spi_global`, `historico_projeto`.

Deploy: `supabase functions deploy --no-verify-jwt spi-mcp` (a função faz a própria autenticação pela chave).
