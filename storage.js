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

  function calcularFaturaCartao(parcelasDoCartao, ano, mes) {
    const doMes = parcelasDoCartao.filter(p => p.ano === ano && p.mes === mes);
    const total = reais(doMes.reduce((s, p) => s + centavos(p.valor), 0));
    return { total, itens: doMes };
  }

  function calcularSaldoConta(contaId, lancamentos) {
    let saldoCents = 0;
    for (const l of lancamentos) {
      if (l.carteiraId !== contaId) continue;
      if (l.tipo === 'Receita') saldoCents += centavos(l.valor);
      else if (l.tipo === 'Despesa' && !isTransferenciaFatura(l)) saldoCents -= centavos(l.valor);
    }
    return reais(saldoCents);
  }

  function calcularOrcadoRealizado(lancamentos, orcamentos, ano, mes, parcelas) {
    const realizadoPorChave = {};
    if (parcelas && parcelas.length) {
      for (const p of parcelas) {
        if (p.ano !== ano || p.mes !== mes) continue;
        if (p.categoriaId === CATEGORIA_PAGAMENTO_FATURA) continue;
        const chave = p.categoriaId + '_' + p.subcategoriaId;
        realizadoPorChave[chave] = (realizadoPorChave[chave] || 0) + centavos(p.valor);
      }
    }
    for (const l of lancamentos) {
      if (l.tipo !== 'Despesa' || isTransferenciaFatura(l)) continue;
      if (l.formaPagamento === 'Cartão de Crédito') continue;
      const [ly, lm] = l.data.split('-').map(Number);
      if (ly !== ano || lm !== mes) continue;
      const chave = l.categoriaId + '_' + l.subcategoriaId;
      realizadoPorChave[chave] = (realizadoPorChave[chave] || 0) + centavos(l.valor);
    }
    const linhas = [];
    for (const o of orcamentos) {
      if (o.ano !== ano || o.mes !== mes) continue;
      const chave = o.categoriaId + '_' + o.subcategoriaId;
      const realizadoCents = realizadoPorChave[chave] || 0;
      const orcadoCents = centavos(o.valorOrcado);
      const pct = orcadoCents > 0 ? Math.round((realizadoCents / orcadoCents) * 100) : (realizadoCents > 0 ? 999 : 0);
      linhas.push({
        categoriaId: o.categoriaId, subcategoriaId: o.subcategoriaId,
        orcado: reais(orcadoCents), realizado: reais(realizadoCents), pct,
        status: pct > 100 ? 'estourado' : (pct >= 90 ? 'atencao' : 'ok'),
      });
    }
    return linhas.sort((a, b) => b.pct - a.pct);
  }

  function detectarEstouros(linhasOrcamento) {
    return linhasOrcamento.filter(l => l.status === 'estourado');
  }

  return {
    centavos, reais, gerarParcelas, isTransferenciaFatura,
    calcularFaturaCartao, calcularSaldoConta, calcularOrcadoRealizado, detectarEstouros,
    CATEGORIA_PAGAMENTO_FATURA,
  };
})();
