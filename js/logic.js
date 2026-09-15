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
  // Reaplicação de rendimento (criada para separar, no Orçamentos, o dinheiro NOVO aportado em
  // Renda Fixa do rendimento que já tinha sido contado como Receita e só está sendo reinvestido).
  // Para fluxo de caixa (Painel geral/Relatórios) ela tem que ser tratada exatamente como um aporte
  // normal: é transferência interna, não gasto novo.
  const SUBCATEGORIA_REAPLICACAO_RENDIMENTO = 747;
  const CATEGORIA_GANHOS = 7;
  const SUBCATEGORIA_SALDO_INICIAL = 723;
  // Categoria criada para reconciliação: quando o saldo do app diverge do extrato real por causa de
  // lançamentos antigos faltando/duplicados espalhados pelo histórico (o método "saldo = receita −
  // despesa acumulado" não se autocorrige — um furo de qualquer mês passado arrasta o saldo de hoje
  // pra sempre), em vez de caçar cada furo, lança-se aqui a diferença de uma vez. Não é receita nem
  // despesa de verdade, por isso conta pro saldo da conta (calcularSaldoConta, que soma tudo sem
  // filtrar categoria) mas fica de fora de tudo que é fluxo de caixa/orçamento — mesmo tratamento do
  // Saldo Inicial acima.
  const CATEGORIA_AJUSTE_SALDO = 8;

  function isAjusteSaldo(lancamento) {
    return lancamento.categoriaId === CATEGORIA_AJUSTE_SALDO;
  }

  // Categoria criada para automatizar Metas (antes era um cadastro 100% manual, nunca usado — 0
  // registros mesmo depois de meses de uso do app). Cada meta ganha sua própria subcategoria aqui;
  // "aportar" pra uma meta é lançar uma Despesa nesta subcategoria saindo da conta que o dinheiro
  // realmente saiu (normal, comum, mesma tela de sempre) — e "resgatar" é lançar uma Receita na mesma
  // subcategoria. O valor guardado da meta é sempre Despesas − Receitas dessa subcategoria, nunca
  // digitado à mão, pra não desalinhar do histórico real. Como Investimento, é dinheiro sendo
  // reservado, não gasto novo — por isso também é transferência interna, fora do fluxo de caixa.
  const CATEGORIA_METAS = 9;

  function isTransferenciaInterna(lancamento) {
    if (isTransferenciaFatura(lancamento)) return true;
    if (isAjusteSaldo(lancamento)) return true;
    // Antes só Renda Fixa (713) e Reaplicação de rendimento (747) eram tratadas como transferência —
    // as outras subcategorias da categoria Investimento (DinDin, Renda Variável, Bolsa, Consórcio)
    // ficavam de fora e contavam como receita/despesa real. Isso só não tinha aparecido ainda porque
    // nenhuma delas tinha lançamento — assim que o usuário registrou uma compra de Tesouro (Renda
    // Variável), ela entrou inflando "Receitas do mês" à toa. Categoria Investimento inteira é sempre
    // dinheiro mudando de lugar (conta comum ⇄ carteira de investimento), nunca ganho ou gasto novo —
    // por isso a checagem agora é pela categoria toda, não mais por subcategoria específica.
    if (lancamento.categoriaId === CATEGORIA_INVESTIMENTO_APORTE) return true;
    if (lancamento.categoriaId === CATEGORIA_METAS) return true;
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
      if (isAjusteSaldo(l)) continue;
      if (l.tipo === 'Despesa') {
        if (isTransferenciaFatura(l)) continue;
        if (l.formaPagamento === 'Cartão de Crédito') continue;
        realizadoPorChave[chave] = (realizadoPorChave[chave] || 0) + centavos(l.valor);
      } else if (l.tipo === 'Receita') {
        realizadoReceitaPorChave[chave] = (realizadoReceitaPorChave[chave] || 0) + centavos(l.valor);
      }
    }
    const linhas = [];
    const chavesCobertas = new Set();
    for (const o of orcamentos) {
      if (o.ano !== ano || o.mes !== mes) continue;
      const chave = o.categoriaId + '_' + o.subcategoriaId;
      chavesCobertas.add(chave);
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
    // Gasto/ganho real numa subcategoria SEM orçamento definido para o mês não pode ficar invisível
    // aqui — senão esta tela nunca bate com o Painel geral (que soma tudo, orçado ou não), e passa a
    // impressão errada de que "sobrou" dinheiro que na real só não foi planejado. Entra com orçado
    // R$0 (ou seja, 100% fora do previsto), pra aparecer e ser visto, não escondido.
    function linhasSemOrcamento(mapa, tipo) {
      Object.keys(mapa).forEach(chave => {
        if (chavesCobertas.has(chave)) return;
        const realizadoCents = mapa[chave];
        if (!realizadoCents) return;
        const [categoriaId, subcategoriaId] = chave.split('_').map(Number);
        linhas.push({
          categoriaId, subcategoriaId, tipo, orcado: 0, realizado: reais(realizadoCents),
          pct: 999, status: tipo === 'Receita' ? 'ok' : 'estourado',
        });
        chavesCobertas.add(chave);
      });
    }
    linhasSemOrcamento(realizadoPorChave, 'Despesa');
    linhasSemOrcamento(realizadoReceitaPorChave, 'Receita');
    return linhas.sort((a, b) => b.pct - a.pct);
  }

  function detectarEstouros(linhasOrcamento) {
    return linhasOrcamento.filter(l => l.status === 'estourado');
  }

  // ===================== Alertas Financeiros =====================
  // Painel de indicadores de alerta + ação de contenção, pedido pelo usuário depois de uma conversa
  // sobre saúde financeira. Cada regra "mede" um sintoma real (juros, meses no vermelho, gasto não
  // categorizado, assinatura com cobrança fora do padrão, subcategoria estourando o orçamento vários
  // meses seguidos, reserva de emergência baixa) e diz se ela está "disparando" hoje.
  //
  // Decisão de design: toda janela de tempo usa só MESES FECHADOS (o mês corrente, em andamento, nunca
  // entra na conta) — um mês pela metade quase sempre parece "vermelho" ou "sem estouro" por acaso,
  // dependendo do dia em que você olha, o que geraria alerta piscando. Isso vale tanto pra decidir se
  // o alerta dispara HOJE quanto pra reavaliar 3 meses depois de uma decisão tomada.
  const ALERTA_JUROS_SUBCATEGORIA = 703; // 🏦Juros bancários
  const ALERTA_ASSINATURA_CATEGORIA = 4; // 📺Assinatura

  function ymAdd(ym, delta) {
    let [y, m] = ym.split('-').map(Number);
    m += delta;
    while (m > 12) { m -= 12; y++; }
    while (m < 1) { m += 12; y--; }
    return y + '-' + String(m).padStart(2, '0');
  }

  // Últimos N meses TERMINADOS antes do mês de asOfISO (não inclui o mês de asOfISO).
  function mesesFechados(asOfISO, n) {
    const ymAtual = asOfISO.slice(0, 7);
    const arr = [];
    for (let i = n; i >= 1; i--) arr.push(ymAdd(ymAtual, -i));
    return arr;
  }

  function medianaLista(arr) {
    const s = [...arr].sort((a, b) => a - b);
    const n = s.length;
    if (!n) return 0;
    return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
  }

  function despesaRealizadaNoMes(state, ym) {
    const [ano, mes] = ym.split('-').map(Number);
    let total = 0;
    state.lancamentos.forEach(l => {
      if (l.data.slice(0, 7) !== ym || l.tipo !== 'Despesa') return;
      if (isTransferenciaInterna(l) || isAjusteSaldo(l)) return;
      if (l.formaPagamento === 'Cartão de Crédito') return; // entra via parcela, não duplicar
      total += l.valor;
    });
    (state.parcelas || []).forEach(p => {
      if (p.ano === ano && p.mes === mes && p.categoriaId !== CATEGORIA_PAGAMENTO_FATURA) total += p.valor;
    });
    return total;
  }

  // ---- Regra 1: juros bancários nos últimos 3 meses fechados ----
  function medirJuros(state, asOfISO) {
    const meses = mesesFechados(asOfISO, 3);
    const total = state.lancamentos
      .filter(l => l.subcategoriaId === ALERTA_JUROS_SUBCATEGORIA && meses.includes(l.data.slice(0, 7)))
      .reduce((s, l) => s + l.valor, 0);
    return { valor: reais(centavos(total)), meses };
  }

  // ---- Regra 2: meses no vermelho nos últimos 6 meses fechados ----
  function medirMesesVermelho(state, asOfISO) {
    const meses = mesesFechados(asOfISO, 6);
    let receitaPorMes = {};
    state.lancamentos.forEach(l => {
      if (isTransferenciaInterna(l) || isAjusteSaldo(l) || l.tipo !== 'Receita') return;
      const ym = l.data.slice(0, 7);
      if (!meses.includes(ym)) return;
      receitaPorMes[ym] = (receitaPorMes[ym] || 0) + l.valor;
    });
    let qtdVermelho = 0;
    const detalhe = meses.map(ym => {
      const receita = receitaPorMes[ym] || 0;
      const despesa = despesaRealizadaNoMes(state, ym);
      const saldo = reais(centavos(receita) - centavos(despesa));
      if (saldo < 0) qtdVermelho++;
      return { ym, saldo };
    });
    return { valor: qtdVermelho, meses, detalhe };
  }

  // ---- Regra 3: subcategoria "Outros" com volume relevante nos últimos 6 meses fechados ----
  const CATEGORIAS_NAO_GASTO = [CATEGORIA_INVESTIMENTO_APORTE, CATEGORIA_PAGAMENTO_FATURA, CATEGORIA_GANHOS, CATEGORIA_AJUSTE_SALDO, CATEGORIA_METAS];
  function subcategoriasOutros(state) {
    return state.subcategorias.filter(s => s.ativa !== false && /outros/i.test(s.nome) && !CATEGORIAS_NAO_GASTO.includes(s.categoriaId));
  }
  function medirOutros(state, asOfISO, subcategoriaId) {
    const meses = mesesFechados(asOfISO, 6);
    const total = state.lancamentos
      .filter(l => l.subcategoriaId === subcategoriaId && l.tipo === 'Despesa' && meses.includes(l.data.slice(0, 7)))
      .reduce((s, l) => s + l.valor, 0);
    return { valor: reais(centavos(total)), meses };
  }

  // ---- Regra 4: lançamento de assinatura com valor fora do padrão da própria subcategoria, dentro
  // dos últimos 3 meses fechados. "Padrão" = mediana dos OUTROS lançamentos daquela subcategoria
  // (leave-one-out), pra não precisar de histórico longo nem se confundir com reajuste gradual de preço.
  function medirAssinatura(state, asOfISO, subcategoriaId) {
    const meses = mesesFechados(asOfISO, 3);
    const todos = state.lancamentos.filter(l => l.subcategoriaId === subcategoriaId).sort((a, b) => a.data.localeCompare(b.data));
    let piorValor = 0, piorLancamento = null;
    todos.forEach((l, i) => {
      if (!meses.includes(l.data.slice(0, 7))) return;
      const outros = todos.filter((_, j) => j !== i).map(x => x.valor);
      const med = medianaLista(outros);
      if (med > 0 && l.valor > med * 1.6 && (l.valor - med) > 20 && l.valor > piorValor) {
        piorValor = l.valor; piorLancamento = { data: l.data, valor: l.valor, valorTipico: reais(centavos(med)) };
      }
    });
    return { valor: piorLancamento ? piorLancamento.valor : 0, lancamento: piorLancamento, meses };
  }

  // ---- Regra 5: subcategoria estourando o orçamento (real, com valorOrcado>0) 3+ meses fechados seguidos ----
  function medirEstouro(state, asOfISO, categoriaId, subcategoriaId) {
    const meses = mesesFechados(asOfISO, 6);
    const pontos = meses.map(ym => {
      const [ano, mes] = ym.split('-').map(Number);
      const linhas = calcularOrcadoRealizado(state.lancamentos, state.orcamentos, ano, mes, state.parcelas);
      const linha = linhas.find(l => l.categoriaId === categoriaId && l.subcategoriaId === subcategoriaId && l.tipo === 'Despesa' && l.orcado > 0);
      return linha ? { ym, estourado: linha.status === 'estourado', pct: linha.pct } : { ym, estourado: false, pct: null, semOrcamento: true };
    });
    let streak = 0;
    for (let i = pontos.length - 1; i >= 0; i--) {
      if (pontos[i].estourado) streak++; else break;
    }
    const ultimoPct = pontos.length ? (pontos[pontos.length - 1].pct || 0) : 0;
    return { valor: streak, pctAtual: ultimoPct, meses, pontos };
  }

  // Varre todas as combinações categoria/subcategoria ATIVAS com orçamento definido em algum mês dos
  // últimos 6 fechados, pra descobrir candidatas à Regra 5 sem precisar de lista fixa.
  function candidatasEstouro(state, asOfISO) {
    const meses = mesesFechados(asOfISO, 6);
    const chaves = new Set();
    state.orcamentos.forEach(o => {
      const ym = o.ano + '-' + String(o.mes).padStart(2, '0');
      if (meses.includes(ym) && o.tipo === 'Despesa' && o.valorOrcado > 0) chaves.add(o.categoriaId + '_' + o.subcategoriaId);
    });
    return [...chaves].map(c => c.split('_').map(Number));
  }

  // ---- Regra 6: reserva de emergência (saldo líquido investido ÷ despesa média mensal) ----
  // Fonte do "investido": a conta tipo "Investimento" (mesmo saldo do card "Patrimônio investido" no
  // Painel geral) — NÃO a tabela manual STATE.investimentos ("Seus ativos"). Motivo: reserva de
  // emergência exige liquidez real (resgate rápido, sem risco de perda de capital); um ativo manual
  // como Tesouro RendA+ 2035 (vencimento longo, resgate antecipado com marcação a mercado) não cumpre
  // isso e não deveria contar. Checado com o usuário: TODA a movimentação da conta Investimento (saldo
  // inicial + aportes/resgates/rendimento) é CDB — genuinamente líquida — enquanto o RendA+ 2035 nunca
  // passou por essa conta, só existe na tabela manual. Por isso a conta já é o pool certo, sem precisar
  // de um sinalizador de liquidez por ativo.
  function medirReserva(state, asOfISO) {
    const meses = mesesFechados(asOfISO, 6);
    const contaInv = (state.contas || []).find(c => c.tipo === 'Investimento');
    const lancsAte = state.lancamentos.filter(l => l.data <= asOfISO);
    const totalInvestidoCents = contaInv ? centavos(calcularSaldoConta(contaInv.id, lancsAte)) + centavos(contaInv.saldoInicial || 0) : 0;
    const totalInvestido = reais(totalInvestidoCents);
    const despesaMedia = meses.reduce((s, ym) => s + despesaRealizadaNoMes(state, ym), 0) / (meses.length || 1);
    // Aqui o número que importa é a RAZÃO investido/despesa (ex.: 0,35 meses), não um valor em reais —
    // reais() faz round-trip por centavos (÷100) pra arredondar dinheiro, então usá-la aqui dividiria
    // a razão por 100 sem necessidade. Arredonda a própria razão a 2 casas direto (Math.round ×100 ÷100).
    const razao = despesaMedia > 0 ? totalInvestidoCents / centavos(despesaMedia) : 0;
    const valor = Math.round(razao * 100) / 100;
    return { valor, totalInvestido: reais(centavos(totalInvestido)), despesaMedia: reais(centavos(despesaMedia)), meses };
  }

  // Registro central das regras — usado tanto pra gerar os alertas de hoje quanto pra reavaliar (3
  // meses depois) uma decisão já tomada, chamando a MESMA função de medição com uma data diferente.
  // 'direcaoBoa' diz pra que lado o número precisa andar pra ser uma melhora.
  function definicaoRegra(alertaId, state) {
    if (alertaId === 'juros_bancarios') {
      return { direcaoBoa: 'menor', limiar: 100, medir: (s, d) => medirJuros(s, d).valor };
    }
    if (alertaId === 'meses_vermelho') {
      return { direcaoBoa: 'menor', limiar: 3, medir: (s, d) => medirMesesVermelho(s, d).valor };
    }
    if (alertaId === 'reserva_emergencia') {
      return { direcaoBoa: 'maior', limiar: 3, medir: (s, d) => medirReserva(s, d).valor };
    }
    if (alertaId.startsWith('outros_')) {
      const subId = Number(alertaId.split('_')[1]);
      return { direcaoBoa: 'menor', limiar: 1500, medir: (s, d) => medirOutros(s, d, subId).valor };
    }
    if (alertaId.startsWith('assinatura_')) {
      const subId = Number(alertaId.split('_')[1]);
      return { direcaoBoa: 'menor', limiar: 0, medir: (s, d) => medirAssinatura(s, d, subId).valor };
    }
    if (alertaId.startsWith('estouro_')) {
      const [, catId, subId] = alertaId.split('_').map((v, i) => i === 0 ? v : Number(v));
      return { direcaoBoa: 'menor', limiar: 3, medir: (s, d) => medirEstouro(s, d, catId, subId).valor };
    }
    return null;
  }

  // Reavalia, numa data qualquer (ex.: 3 meses depois da decisão), se um alerta ainda dispara e qual o
  // valor medido — usado pelo app.js quando chega a data de avaliação de uma rodada de decisão.
  function medirAlertaPorId(alertaId, state, asOfISO) {
    const def = definicaoRegra(alertaId, state);
    if (!def) return null;
    const valor = def.medir(state, asOfISO);
    const dispara = def.direcaoBoa === 'menor' ? valor > def.limiar : valor < def.limiar;
    return { valor, dispara, direcaoBoa: def.direcaoBoa };
  }

  function calcularAlertas(state, hojeISO) {
    const alertas = [];

    const juros = medirJuros(state, hojeISO);
    if (juros.valor > 100) {
      alertas.push({
        id: 'juros_bancarios', titulo: 'Juros bancários nos últimos 3 meses', icone: '🏦',
        severidade: juros.valor > 300 ? 'critico' : 'atencao',
        indicador: 'R$ ' + juros.valor.toFixed(2).replace('.', ','),
        evidencia: `Você pagou R$ ${juros.valor.toFixed(2).replace('.', ',')} em juros bancários entre ${juros.meses[0]} e ${juros.meses[2]}.`,
        acoesSugeridas: ['Renegociar a dívida/rotativo com o banco', 'Conferir se alguma fatura está vencendo em atraso', 'Avaliar portabilidade da dívida para uma taxa menor'],
        valorAtual: juros.valor, direcaoBoa: 'menor',
      });
    }

    const vermelho = medirMesesVermelho(state, hojeISO);
    if (vermelho.valor >= 3) {
      alertas.push({
        id: 'meses_vermelho', titulo: 'Meses no vermelho', icone: '📉',
        severidade: vermelho.valor >= 4 ? 'critico' : 'atencao',
        indicador: vermelho.valor + ' de 6 meses',
        evidencia: `${vermelho.valor} dos últimos 6 meses fechados (${vermelho.meses[0]} a ${vermelho.meses[5]}) fecharam com despesa maior que receita.`,
        acoesSugeridas: ['Revisar os gastos variáveis do mês', 'Criar uma reserva de curto prazo pra meses de pico de gasto', 'Rever o orçamento das categorias que mais estouram'],
        valorAtual: vermelho.valor, direcaoBoa: 'menor',
      });
    }

    subcategoriasOutros(state).forEach(sub => {
      const m = medirOutros(state, hojeISO, sub.id);
      if (m.valor > 1500) {
        alertas.push({
          id: 'outros_' + sub.id, titulo: `Gasto não categorizado em "${sub.nome}"`, icone: '❓',
          severidade: m.valor > 4000 ? 'critico' : 'atencao',
          indicador: 'R$ ' + m.valor.toFixed(2).replace('.', ','),
          evidencia: `R$ ${m.valor.toFixed(2).replace('.', ',')} lançados em "${sub.nome}" nos últimos 6 meses fechados — um valor alto pra ficar sem categoria específica.`,
          acoesSugeridas: ['Revisar os lançamentos de "Outros" e criar subcategorias específicas', 'Recategorizar retroativamente os maiores valores'],
          valorAtual: m.valor, direcaoBoa: 'menor',
        });
      }
    });

    state.subcategorias.filter(s => s.ativa !== false && s.categoriaId === ALERTA_ASSINATURA_CATEGORIA).forEach(sub => {
      const m = medirAssinatura(state, hojeISO, sub.id);
      if (m.lancamento) {
        alertas.push({
          id: 'assinatura_' + sub.id, titulo: `Cobrança fora do padrão em "${sub.nome}"`, icone: '📺',
          severidade: 'atencao',
          indicador: 'R$ ' + m.lancamento.valor.toFixed(2).replace('.', ','),
          evidencia: `Em ${m.lancamento.data}, "${sub.nome}" cobrou R$ ${m.lancamento.valor.toFixed(2).replace('.', ',')} — bem acima do valor típico de R$ ${m.lancamento.valorTipico.toFixed(2).replace('.', ',')}.`,
          acoesSugeridas: ['Confirmar se a cobrança está correta', 'Cancelar ou fazer downgrade do plano', 'Contestar a cobrança com a operadora/banco'],
          valorAtual: m.valor, direcaoBoa: 'menor',
        });
      }
    });

    candidatasEstouro(state, hojeISO).forEach(([catId, subId]) => {
      const m = medirEstouro(state, hojeISO, catId, subId);
      if (m.valor >= 3) {
        const cat = state.categorias.find(c => c.id === catId);
        const sub = state.subcategorias.find(s => s.id === subId);
        alertas.push({
          id: 'estouro_' + catId + '_' + subId, titulo: `"${sub ? sub.nome : subId}" estourando o orçamento`, icone: '🔥',
          severidade: m.valor >= 5 ? 'critico' : 'atencao',
          indicador: m.valor + ' meses seguidos',
          evidencia: `"${cat ? cat.nome : catId} > ${sub ? sub.nome : subId}" estourou o orçamento nos últimos ${m.valor} meses fechados seguidos (${m.pctAtual}% do orçado no último mês).`,
          acoesSugeridas: ['Reduzir o consumo nessa subcategoria', 'Ajustar o orçamento pra um valor mais realista', 'Entender se é um gasto pontual que vai parar sozinho'],
          valorAtual: m.valor, direcaoBoa: 'menor',
        });
      }
    });

    const reserva = medirReserva(state, hojeISO);
    if (reserva.valor < 3) {
      alertas.push({
        id: 'reserva_emergencia', titulo: 'Reserva de emergência baixa', icone: '🛟',
        severidade: reserva.valor < 1 ? 'critico' : 'atencao',
        indicador: reserva.valor.toFixed(1).replace('.', ',') + ' meses',
        evidencia: `Seu patrimônio investido (R$ ${reserva.totalInvestido.toFixed(2).replace('.', ',')}) cobre ${reserva.valor.toFixed(1).replace('.', ',')} meses da sua despesa média (R$ ${reserva.despesaMedia.toFixed(2).replace('.', ',')}/mês). O recomendado é ter entre 3 e 6 meses guardados.`,
        acoesSugeridas: ['Definir um aporte mensal fixo pra reserva', 'Pausar outros investimentos até formar a reserva mínima', 'Criar uma Meta de reserva de emergência'],
        valorAtual: reserva.valor, direcaoBoa: 'maior',
      });
    }

    const ordem = { critico: 0, atencao: 1 };
    return alertas.sort((a, b) => ordem[a.severidade] - ordem[b.severidade]);
  }

  return {
    centavos, reais, gerarParcelas, isTransferenciaFatura, isTransferenciaInterna, isAjusteSaldo,
    calcularFaturaCartao, calcularSaldoConta, calcularOrcadoRealizado, detectarEstouros,
    calcularAlertas, medirAlertaPorId,
    CATEGORIA_PAGAMENTO_FATURA, CATEGORIA_AJUSTE_SALDO, CATEGORIA_METAS, CATEGORIA_GANHOS,
  };
})();
