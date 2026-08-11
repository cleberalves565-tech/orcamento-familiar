// Motor de regras de negócio — validado com os 222 lançamentos parcelados reais
// da planilha (100% de aderência em valor e mês de competência) antes de entrar em produção.
const AppLogic = (function () {
  const CATEGORIA_PAGAMENTO_FATURA = 6;

  function centavos(v) { return Math.round(v * 100); }
  function reais(c) { return Math.round(c) / 100; }

  function competenciaBase(dataCompraISO, diaFechamento, diaVencimento) {
    const [y, m, d] = dataCompraISO.split('-').map(Number);
    const cicloOffset = (d <= diaFechamento) ? 1 : 2;
    const base = new Date(Date.UTC(y, m - 1, 1));
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + cicloOffset, Math.min(diaVencimento, 28)));
  }

  function gerarParcelas(valorTotal, qtd, dataCompraISO, diaFechamento, diaVencimento) {
    const totalCents = centavos(valorTotal);
    const per = totalCents / qtd;
    const rounded = Math.round(per);
    const parcelas = [];
    const baseVenc = competenciaBase(dataCompraISO, diaFechamento, diaVencimento);
    let somaAnteriores = 0;
    for (let i = 1; i <= qtd; i++) {
      let valorCents;
      if (i < qtd) { valorCents = rounded; somaAnteriores += rounded; }
      else { valorCents = totalCents - somaAnteriores; }
      const vencDate = new Date(Date.UTC(baseVenc.getUTCFullYear(), baseVenc.getUTCMonth() + (i - 1), baseVenc.getUTCDate()));
      parcelas.push({ numero: i, qtd, valor: reais(valorCents), ano: vencDate.getUTCFullYear(), mes: vencDate.getUTCMonth() + 1 });
    }
    return parcelas;
  }

  function isTransferenciaFatura(lancamento) {
    return lancamento.categoriaId === CATEGORIA_PAGAMENTO_FATURA;
  }

  // Categoria/subcategoria fixas usadas nos lançamentos de aporte/resgate de CDB (💰Investimento >
  // 🏛Renda Fixa) e no saldo inicial importado (💵Ganhos > 💲Saldo). Nenhuma das duas é "receita" ou
  // "despesa" de verdade — é dinheiro seu mudando de lugar (conta corrente ⇄ investimento) ou o ponto
  // de partida do histórico. O RENDIMENTO em si (💵Ganhos > 💸Investimento) continua contando normal,
  // porque isso é ganho real. Usado nos relatórios de fluxo de caixa (Painel geral e Relatórios) para
  // não inflar "Receitas/Despesas do mês" nem distorcer a evolução e o saldo acumulado.
  const CATEGORIA_INVESTIMENTO_APORTE = 5;
  const SUBCATEGORIA_RENDA_FIXA = 713;
  const CATEGORIA_GANHOS = 7;
  const SUBCATEGORIA_SALDO_INICIAL = 723;

  function isTransferenciaInterna(lancamento) {
    if (isTransferenciaFatura(lancamento)) return true;
    if (lancamento.categoriaId === CATEGORIA_INVESTIMENTO_APORTE && lancamento.subcategoriaId === SUBCATEGORIA_RENDA_FIXA) return true;
    if (lancamento.categoriaId === CATEGORIA_GANHOS && lancamento.subcategoriaId === SUBCATEGORIA_SALDO_INICIAL) return true;
    return false;
  }

  function calcularFaturaCartao(parcelasDoCartao, ano, mes) {
    const doMes = parcelasDoCartao.filter(p => p.ano === ano && p.mes === mes);
    const total = reais(doMes.reduce((s, p) => s + centavos(p.valor), 0));
    return { total, itens: doMes };
  }

  function calcularSaldoConta(contaId, lancamentos) {
    // Pagamento de fatura É uma saída de caixa real da conta que paga — só é ignorado em
    // calcularOrcadoRealizado (para não contar a mesma compra 2x: uma vez na parcela, outra na fatura).
    // Aqui, para o saldo da conta, ele tem que entrar, senão o saldo fica artificialmente inflado.
    let saldoCents = 0;
    for (const l of lancamentos) {
      if (l.carteiraId !== contaId) continue;
      if (l.tipo === 'Receita') saldoCents += centavos(l.valor);
      else if (l.tipo === 'Despesa') saldoCents -= centavos(l.valor);
    }
    return reais(saldoCents);
  }

  function calcularOrcadoRealizado(lancamentos, orcamentos, ano, mes, parcelas) {
    // Cada orçamento tem tipo Despesa ou Receita (ex.: categoria "Ganhos" é orçamento de RECEITA —
    // quanto você espera ganhar). Antes, esta função só somava despesas, então todo orçamento de
    // Receita ficava travado em 0% de realizado mesmo com dinheiro entrando de verdade. Agora soma os
    // dois lados separadamente e cada orçamento busca no lado certo, pelo seu próprio tipo.
    const realizadoPorChave = {};
    const realizadoReceitaPorChave = {};
    if (parcelas && parcelas.length) {
      for (const p of parcelas) {
        if (p.ano !== ano || p.mes !== mes) continue;
        if (p.categoriaId === CATEGORIA_PAGAMENTO_FATURA) continue;
        const chave = p.categoriaId + '_' + p.subcategoriaId;
        realizadoPorChave[chave] = (realizadoPorChave[chave] || 0) + centavos(p.valor);
      }
    }
    for (const l of lancamentos) {
      const [ly, lm] = l.data.split('-').map(Number);
      if (ly !== ano || lm !== mes) continue;
      const chave = l.categoriaId + '_' + l.subcategoriaId;
      if (l.tipo === 'Despesa') {
        if (isTransferenciaFatura(l)) continue;
        if (l.formaPagamento === 'Cartão de Crédito') continue;
        realizadoPorChave[chave] = (realizadoPorChave[chave] || 0) + centavos(l.valor);
      } else if (l.tipo === 'Receita') {
        realizadoReceitaPorChave[chave] = (realizadoReceitaPorChave[chave] || 0) + centavos(l.valor);
      }
    }
    const linhas = [];
    for (const o of orcamentos) {
      if (o.ano !== ano || o.mes !== mes) continue;
      const chave = o.categoriaId + '_' + o.subcategoriaId;
      const mapaCerto = o.tipo === 'Receita' ? realizadoReceitaPorChave : realizadoPorChave;
      const realizadoCents = mapaCerto[chave] || 0;
      const orcadoCents = centavos(o.valorOrcado);
      const pct = orcadoCents > 0 ? Math.round((realizadoCents / orcadoCents) * 100) : (realizadoCents > 0 ? 999 : 0);
      // Para Despesa, passar de 100% é ruim (gastou mais do que devia) — vermelho/"estourado". Para
      // Receita, é o oposto: passar de 100% é bom (ganhou mais do que esperava) — verde. Uma Receita
      // nunca fica "estourada" (não faz sentido "estourar" uma meta de ganho) — no máximo fica "atencao"
      // (ainda não bateu a meta), o que também a mantém fora do banner de "estouraram o orçamento".
      const status = o.tipo === 'Receita'
        ? (pct >= 100 ? 'ok' : 'atencao')
        : (pct > 100 ? 'estourado' : (pct >= 90 ? 'atencao' : 'ok'));
      linhas.push({
        categoriaId: o.categoriaId, subcategoriaId: o.subcategoriaId, tipo: o.tipo,
        orcado: reais(orcadoCents), realizado: reais(realizadoCents), pct, status,
      });
    }
    return linhas.sort((a, b) => b.pct - a.pct);
  }

  function detectarEstouros(linhasOrcamento) {
    return linhasOrcamento.filter(l => l.status === 'estourado');
  }

  return {
    centavos, reais, gerarParcelas, isTransferenciaFatura, isTransferenciaInterna,
    calcularFaturaCartao, calcularSaldoConta, calcularOrcadoRealizado, detectarEstouros,
    CATEGORIA_PAGAMENTO_FATURA,
  };
})();
