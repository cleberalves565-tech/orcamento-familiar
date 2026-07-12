// Controlador da interface — liga as telas aprovadas na Etapa 2 aos dados reais,
// ao motor de regras (logic.js) e ao armazenamento criptografado (storage.js).

const CATEGORIA_ICONS = { 1: '🏠', 2: '💸', 3: '🧾', 4: '📺', 5: '💰', 6: '🔁', 7: '💵' };
const MESES_NOMES = ['', 'Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

function fmtMoeda(v) {
  const n = Number(v) || 0;
  const sinal = n < 0 ? '-' : '';
  return sinal + 'R$ ' + Math.abs(n).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtData(iso) {
  const [y, m, d] = iso.split('-');
  return d + '/' + m;
}
function uuid() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
const MAX_PARCELAS = 18;
function parcelaOptionsHtml() {
  let html = '<option value="1">À vista (1x)</option>';
  for (let n = 2; n <= MAX_PARCELAS; n++) html += `<option value="${n}">${n}x</option>`;
  return html;
}

let STATE = null;
let VIEW = { ano: 2026, mes: 7 };
let inactivityTimer = null;

// ---------------- Construção do estado inicial a partir da planilha ----------------
function buildInitialStateFromSeed() {
  const contas = SEED.carteiras.filter(c => !c.ehCartao);
  const cartoes = SEED.carteiras.filter(c => c.ehCartao);
  const cartaoMap = {}; cartoes.forEach(c => cartaoMap[c.id] = c);

  let parcelas = SEED.parcelas.map(p => {
    const dc = p.dataCompetencia ? p.dataCompetencia.split('-') : null;
    return {
      id: p.id, lancamentoId: p.lancamentoId, carteiraId: p.carteiraId,
      categoriaId: p.categoriaId, subcategoriaId: p.subcategoriaId,
      valor: p.valorParcela, numero: p.numero, qtd: p.qtdParcelas,
      ano: dc ? Number(dc[0]) : null, mes: dc ? Number(dc[1]) : null,
    };
  });

  const temParcela = new Set(parcelas.map(p => p.lancamentoId));
  for (const l of SEED.lancamentos) {
    if (l.formaPagamento === 'Cartão de Crédito' && !temParcela.has(l.id)) {
      const cartao = cartaoMap[l.carteiraId];
      if (cartao) {
        const geradas = AppLogic.gerarParcelas(l.valor, l.qtdParcelas || 1, l.data, cartao.diaFechamento, cartao.diaVencimento);
        geradas.forEach(g => parcelas.push({
          id: 'gen_' + l.id + '_' + g.numero, lancamentoId: l.id, carteiraId: l.carteiraId,
          categoriaId: l.categoriaId, subcategoriaId: l.subcategoriaId,
          valor: g.valor, numero: g.numero, qtd: g.qtd, ano: g.ano, mes: g.mes,
        }));
      }
    }
  }

  return {
    contas, cartoes,
    categorias: SEED.categorias, subcategorias: SEED.subcategorias,
    lancamentos: SEED.lancamentos.slice(),
    parcelas,
    orcamentos: SEED.orcamentos.slice(),
    metas: [], investimentos: [],
    config: { chatIA: false, bloqueioMin: 5, modoAgregado: true },
  };
}

function buildEmptyState() {
  return {
    contas: [], cartoes: [], categorias: SEED.categorias, subcategorias: SEED.subcategorias,
    lancamentos: [], parcelas: [], orcamentos: [], metas: [], investimentos: [],
    config: { chatIA: false, bloqueioMin: 5, modoAgregado: true },
  };
}

async function persist() {
  await AppStorage.saveState(STATE);
  try {
    if (await AppSync.isEnabled()) {
      const raw = await AppStorage.getRaw();
      await AppSync.write(raw);
      document.dispatchEvent(new CustomEvent('sync-status', { detail: 'ok' }));
    }
  } catch (e) {
    document.dispatchEvent(new CustomEvent('sync-status', { detail: 'erro' }));
  }
}

// ---------------- Verificação de integridade (auditoria real) ----------------
function verificarIntegridade() {
  const porLanc = {};
  for (const p of STATE.parcelas) { (porLanc[p.lancamentoId] = porLanc[p.lancamentoId] || []).push(p); }
  let ok = 0, divergentes = [];
  for (const l of STATE.lancamentos) {
    if (l.formaPagamento !== 'Cartão de Crédito') continue;
    const plist = porLanc[l.id] || [];
    const somaParcelas = AppLogic.reais(plist.reduce((s, p) => s + AppLogic.centavos(p.valor), 0));
    if (Math.abs(somaParcelas - l.valor) < 0.02) ok++;
    else divergentes.push({ id: l.id, descricao: l.descricao, valor: l.valor, somaParcelas });
  }
  return { ok, total: ok + divergentes.length, divergentes };
}

// ---------------- Auth ----------------
const Auth = {
  pinBuffer: '',
  modo: 'login',

  async boot() {
    const existe = await AppStorage.hasVault();
    if (existe) this.renderLogin();
    else this.renderOnboardingStep1();
  },

  resetInactivity() {
    clearTimeout(inactivityTimer);
    if (!STATE) return;
    const min = (STATE.config && STATE.config.bloqueioMin) || 5;
    if (min <= 0) return;
    inactivityTimer = setTimeout(() => this.lockNow(), min * 60 * 1000);
  },

  lockNow() {
    AppStorage.lock();
    STATE = null;
    document.getElementById('app').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    this.renderLogin();
  },

  renderLogin() {
    document.getElementById('app').style.display = 'none';
    document.getElementById('authScreen').style.display = 'flex';
    this.pinBuffer = '';
    const area = document.getElementById('authArea');
    area.innerHTML = `
      <div class="pin-wrap">
        <div class="brand-icon" style="width:52px; height:52px; margin:0 auto 16px; font-size:20px;">OF</div>
        <div style="font-weight:600; font-size:17px;">Digite seu PIN</div>
        <div class="pin-dots" id="pinDots"></div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<div class="pin-key" onclick="Auth.pressKey('${n}')">${n}</div>`).join('')}
          <div class="pin-key" style="opacity:.3;"></div>
          <div class="pin-key" onclick="Auth.pressKey('0')">0</div>
          <div class="pin-key" onclick="Auth.pressKey('back')">⌫</div>
        </div>
        <div class="stat-sub" id="loginMsg" style="margin-top:18px; min-height:16px;"></div>
      </div>`;
    this.paintDots();
  },

  paintDots() {
    const el = document.getElementById('pinDots');
    if (!el) return;
    const n = Math.max(this.pinBuffer.length, 4);
    el.innerHTML = Array.from({ length: Math.max(n,4) }).map((_, i) =>
      `<div class="pin-dot ${i < this.pinBuffer.length ? 'filled' : ''}"></div>`).join('');
  },

  async pressKey(k) {
    if (k === 'back') { this.pinBuffer = this.pinBuffer.slice(0, -1); this.paintDots(); return; }
    if (this.pinBuffer.length >= 8) return;
    this.pinBuffer += k;
    this.paintDots();
    if (this.pinBuffer.length >= 4 && this.modo === 'login') {
      await this.tryLogin();
    } else if (this.modo === 'setPin1' && this.pinBuffer.length >= 4) {
      // aguarda botão continuar (definido no render de onboarding)
    }
  },

  async tryLogin() {
    const msg = document.getElementById('loginMsg');
    try {
      const pinUsado = this.pinBuffer;
      STATE = await AppStorage.unlockVault(pinUsado);
      document.getElementById('authScreen').style.display = 'none';
      document.getElementById('app').style.display = 'flex';
      Nav.show('dashboard');
      this.resetInactivity();
      Sync.checkNewerOnLogin(pinUsado);
    } catch (e) {
      if (msg) msg.textContent = 'PIN incorreto — tente novamente.';
      this.pinBuffer = '';
      this.paintDots();
    }
  },

  // ---- onboarding ----
  novoPin: '',
  renderOnboardingStep1() {
    this.modo = 'onboarding';
    const area = document.getElementById('authArea');
    area.innerHTML = `
      <div class="pin-wrap">
        <div class="brand-icon" style="width:52px; height:52px; margin:0 auto 16px; font-size:20px;">OF</div>
        <div style="font-weight:600; font-size:17px;">Crie seu PIN (4 a 6 dígitos)</div>
        <div class="pin-dots" id="pinDots"></div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<div class="pin-key" onclick="Auth.pressOnboardKey('${n}')">${n}</div>`).join('')}
          <div class="pin-key" style="opacity:.3;"></div>
          <div class="pin-key" onclick="Auth.pressOnboardKey('0')">0</div>
          <div class="pin-key" onclick="Auth.pressOnboardKey('back')">⌫</div>
        </div>
        <button class="btn" style="margin-top:18px; width:260px;" onclick="Auth.confirmPin1()">Continuar</button>
        <div class="stat-sub" id="loginMsg" style="margin-top:10px; min-height:16px;"></div>
      </div>`;
    this.pinBuffer = '';
    this.paintDots();
  },
  pressOnboardKey(k) {
    if (k === 'back') { this.pinBuffer = this.pinBuffer.slice(0, -1); this.paintDots(); return; }
    if (this.pinBuffer.length >= 6) return;
    this.pinBuffer += k; this.paintDots();
  },
  confirmPin1() {
    if (this.pinBuffer.length < 4) {
      document.getElementById('loginMsg').textContent = 'Use pelo menos 4 dígitos.'; return;
    }
    this.novoPin = this.pinBuffer;
    this.renderOnboardingStep2();
  },
  renderOnboardingStep2() {
    const area = document.getElementById('authArea');
    area.innerHTML = `
      <div class="pin-wrap">
        <div style="font-weight:600; font-size:17px;">Confirme seu PIN</div>
        <div class="pin-dots" id="pinDots"></div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<div class="pin-key" onclick="Auth.pressConfirmKey('${n}')">${n}</div>`).join('')}
          <div class="pin-key" style="opacity:.3;"></div>
          <div class="pin-key" onclick="Auth.pressConfirmKey('0')">0</div>
          <div class="pin-key" onclick="Auth.pressConfirmKey('back')">⌫</div>
        </div>
        <div class="stat-sub" id="loginMsg" style="margin-top:18px; min-height:16px;"></div>
      </div>`;
    this.pinBuffer = '';
    this.paintDots();
  },
  pressConfirmKey(k) {
    if (k === 'back') { this.pinBuffer = this.pinBuffer.slice(0, -1); this.paintDots(); return; }
    if (this.pinBuffer.length >= 6) return;
    this.pinBuffer += k; this.paintDots();
    if (this.pinBuffer.length === this.novoPin.length) {
      if (this.pinBuffer === this.novoPin) this.renderOnboardingStep3();
      else {
        document.getElementById('loginMsg').textContent = 'Os PINs não conferem — tente de novo.';
        setTimeout(() => this.renderOnboardingStep1(), 900);
      }
    }
  },
  renderOnboardingStep3() {
    const area = document.getElementById('authArea');
    const temImportacaoReal = SEED.lancamentos && SEED.lancamentos.length > 0;
    area.innerHTML = `
      <div class="topbar"><h1>Configuração inicial</h1></div>
      <div class="steps"><div class="step done"></div><div class="step done"></div><div class="step done"></div><div class="step"></div></div>
      <div class="card" style="max-width:480px;">
        <div class="row-title" style="margin-bottom:14px; font-size:15px;">Como você quer começar?</div>
        ${temImportacaoReal ? `
        <div class="row" style="border:1px solid var(--accent); border-radius:10px; padding:14px; margin-bottom:10px; cursor:pointer;" onclick="Auth.finishOnboarding(true)">
          <div><div class="row-title">Importar da planilha (recomendado)</div><div class="row-sub">Traz os ${SEED.lancamentos.length} lançamentos reais, categorias, cartões e orçamentos já cadastrados</div></div>
        </div>` : ''}
        <div class="row" style="border:1px solid var(--border); border-radius:10px; padding:14px; cursor:pointer; margin-bottom:10px;" onclick="Auth.finishOnboarding(false)">
          <div><div class="row-title">Começar vazio</div><div class="row-sub">Cadastrar tudo manualmente aos poucos</div></div>
        </div>
        <div class="row" style="border:1px solid var(--accent); border-radius:10px; padding:14px; cursor:pointer;" onclick="Auth.iniciarSincronizacaoExistente()">
          <div><div class="row-title">Já uso o app em outro aparelho${temImportacaoReal ? '' : ' (recomendado)'}</div><div class="row-sub">Conectar a este mesmo arquivo sincronizado e trazer os dados de lá</div></div>
        </div>
      </div>`;
  },
  async iniciarSincronizacaoExistente() {
    if (!AppSync.supported()) { this.iniciarSincronizacaoExistenteManual(); return; }
    try {
      await AppSync.pickExistingFile();
      const raw = await AppSync.read();
      if (!raw) { alert('Não encontramos dados válidos nesse arquivo.'); return; }
      this._syncedRaw = raw;
      this.renderSyncPinEntry();
    } catch (e) { /* usuário cancelou a escolha do arquivo */ }
  },
  iniciarSincronizacaoExistenteManual() {
    // Fallback universal (celular, Safari, qualquer navegador sem File System Access API):
    // usa um seletor de arquivo comum em vez do recurso exclusivo de Chrome/Edge no computador.
    // IMPORTANTE: o <input> precisa estar de fato no documento (mesmo que invisível) antes do
    // .click() — em alguns navegadores de celular (principalmente Safari/iOS), chamar .click()
    // num elemento criado em memória mas nunca inserido na página não abre o seletor de arquivos
    // de forma confiável. Por isso ele é anexado ao <body> e removido logo depois de usado —
    // igual ao input oculto já usado com sucesso em Configurações → "Sincronizar agora".
    let input = document.getElementById('fileOnboardingSync');
    if (input) input.remove();
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'fileOnboardingSync';
    input.style.display = 'none';
    // Sem "accept" restritivo: alguns apps de arquivos (ex.: OneDrive no celular)
    // nao reconhecem a extensao .kfsync e desabilitam o arquivo na selecao se
    // houver filtro. O conteudo e validado depois de escolhido, entao aceitar
    // qualquer arquivo aqui e mais robusto.
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const texto = await file.text();
        const raw = JSON.parse(texto);
        if (!raw || !raw.salt || !raw.payload) { alert('Arquivo inválido.'); return; }
        this._syncedRaw = raw;
        this.renderSyncPinEntry();
      } catch (e) {
        alert('Não foi possível ler esse arquivo: ' + e.message);
      } finally {
        input.remove();
      }
    };
    document.body.appendChild(input);
    input.click();
  },
  renderSyncPinEntry() {
    const area = document.getElementById('authArea');
    area.innerHTML = `
      <div class="topbar"><h1>Digite o PIN já usado no outro aparelho</h1></div>
      <div class="card" style="max-width:360px; text-align:center;">
        <div class="pin-dots" id="pinDots"></div>
        <div class="pin-pad">
          ${[1,2,3,4,5,6,7,8,9].map(n => `<div class="pin-key" onclick="Auth.pressSyncKey('${n}')">${n}</div>`).join('')}
          <div class="pin-key" style="opacity:.3;"></div>
          <div class="pin-key" onclick="Auth.pressSyncKey('0')">0</div>
          <div class="pin-key" onclick="Auth.pressSyncKey('back')">⌫</div>
        </div>
        <div class="stat-sub" id="loginMsg" style="margin-top:18px; min-height:16px;"></div>
        <button class="btn ghost sm" style="margin-top:10px;" onclick="Auth.renderOnboardingStep3()">Voltar</button>
      </div>`;
    this.pinBuffer = '';
    this.paintDots();
  },
  async pressSyncKey(k) {
    const msg = document.getElementById('loginMsg');
    if (k === 'back') { this.pinBuffer = this.pinBuffer.slice(0, -1); this.paintDots(); return; }
    if (this.pinBuffer.length >= 6) return;
    this.pinBuffer += k; this.paintDots();
    if (this.pinBuffer.length >= 4) {
      try {
        STATE = await AppStorage.unlockVaultFromRaw(this.pinBuffer, this._syncedRaw);
        await AppStorage.adoptRaw(this._syncedRaw);
        document.getElementById('authScreen').style.display = 'none';
        document.getElementById('app').style.display = 'flex';
        Nav.show('dashboard');
        this.resetInactivity();
      } catch (e) {
        if (this.pinBuffer.length === 6) {
          if (msg) msg.textContent = 'PIN incorreto — tente novamente.';
          this.pinBuffer = '';
          this.paintDots();
        }
      }
    }
  },
  async finishOnboarding(importar) {
    const initial = importar ? buildInitialStateFromSeed() : buildEmptyState();
    if (importar) {
      const receitas = AppLogic.reais(initial.lancamentos.filter(l=>l.tipo==='Receita').reduce((s,l)=>s+AppLogic.centavos(l.valor),0));
      const despesas = AppLogic.reais(initial.lancamentos.filter(l=>l.tipo==='Despesa').reduce((s,l)=>s+AppLogic.centavos(l.valor),0));
      const area = document.getElementById('authArea');
      area.innerHTML = `
        <div class="topbar"><h1>Conferência da importação</h1></div>
        <div class="steps"><div class="step done"></div><div class="step done"></div><div class="step done"></div><div class="step done"></div></div>
        <div class="card" style="max-width:480px;">
          <div class="row"><div class="row-title">Lançamentos importados</div><div class="row-value">${initial.lancamentos.length}</div></div>
          <div class="row"><div class="row-title">Total de receitas</div><div class="row-value up">${fmtMoeda(receitas)}</div></div>
          <div class="row"><div class="row-title">Total de despesas</div><div class="row-value down">${fmtMoeda(despesas)}</div></div>
          <div class="row"><div class="row-title">Contas / Cartões</div><div class="row-value">${initial.contas.length} / ${initial.cartoes.length}</div></div>
          <div class="row"><div class="row-title">Categorias / Subcategorias</div><div class="row-value">${initial.categorias.length} / ${initial.subcategorias.length}</div></div>
        </div>
        <div class="logic-note" style="max-width:480px;"><span>ℹ️</span><div>Confira estes números com sua planilha antes de continuar. Se baterem, seus dados foram migrados corretamente.</div></div>
        <button class="btn" style="max-width:480px; width:100%; margin-top:10px;" onclick="Auth.reallyFinish()">Confirmar e começar a usar</button>`;
      this._pendingInitial = initial;
    } else {
      this._pendingInitial = initial;
      await this.reallyFinish();
    }
  },
  async reallyFinish() {
    STATE = this._pendingInitial;
    await AppStorage.createVault(this.novoPin, STATE);
    document.getElementById('authScreen').style.display = 'none';
    document.getElementById('app').style.display = 'flex';
    Nav.show('dashboard');
    this.resetInactivity();
  },
};

// ---------------- Navegação ----------------
const Nav = {
  atual: 'dashboard',
  show(id) {
    this.atual = id;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const item = document.querySelector('.nav-item[data-screen="' + id + '"]');
    if (item) item.classList.add('active');
    document.getElementById('mainArea').scrollTop = 0;
    Render.screen(id);
    Auth.resetInactivity();
  },
};

document.addEventListener('mousemove', () => Auth.resetInactivity());
document.addEventListener('keydown', () => Auth.resetInactivity());
document.addEventListener('click', () => Auth.resetInactivity());

window.addEventListener('DOMContentLoaded', () => { Auth.boot(); });

// ---------------- Helpers de dados ----------------
function categoriaNome(id) { const c = STATE.categorias.find(c => c.id === id); return c ? c.nome : '—'; }
function subcategoriaNome(id) { const s = STATE.subcategorias.find(s => s.id === id); return s ? s.nome : '—'; }
function contaOuCartaoNome(id) {
  const c = STATE.contas.find(c => c.id === id); if (c) return c.nome;
  const k = STATE.cartoes.find(k => k.id === id); if (k) return k.nome;
  return '—';
}
function lancamentosDoMes(ano, mes) {
  return STATE.lancamentos.filter(l => { const [y, m] = l.data.split('-').map(Number); return y === ano && m === mes; });
}

// ---------------- "Itens" — a mesma despesa vista pelo regime de caixa/competência de parcela ----------------
// Uma compra à vista/débito/PIX conta no mês em que foi feita (igual antes).
// Uma compra no CARTÃO DE CRÉDITO passa a contar no(s) mês(es) em que cada parcela VENCE — a mesma lógica que
// já era usada só na tela de Cartões (fatura) e em Orçamentos (calcularOrcadoRealizado) — em vez de jogar o
// valor total no mês da compra. Isso reflete melhor "o que realmente compromete sua conta em cada mês".
function itensTodoPeriodo() {
  const itens = [];
  STATE.lancamentos.forEach(l => {
    if (l.formaPagamento === 'Cartão de Crédito') return; // representado pelas parcelas, abaixo
    itens.push({
      id: l.id, lancamentoId: l.id, tipo: l.tipo, data: l.data,
      categoriaId: l.categoriaId, subcategoriaId: l.subcategoriaId, descricao: l.descricao,
      valor: l.valor, formaPagamento: l.formaPagamento, carteiraId: l.carteiraId,
      isParcela: false, numero: null, qtd: null,
      transferencia: AppLogic.isTransferenciaFatura(l),
    });
  });
  STATE.parcelas.forEach(p => {
    if (p.ano == null || p.mes == null) return;
    const l = STATE.lancamentos.find(x => x.id === p.lancamentoId);
    if (!l) return; // parcela órfã — não deveria acontecer, mas protege contra dado inconsistente
    const cartao = STATE.cartoes.find(c => c.id === p.carteiraId);
    const dia = cartao ? Math.min(cartao.diaVencimento, 28) : 1;
    const dataSint = p.ano + '-' + String(p.mes).padStart(2, '0') + '-' + String(dia).padStart(2, '0');
    itens.push({
      id: p.id, lancamentoId: l.id, tipo: l.tipo, data: dataSint,
      categoriaId: p.categoriaId, subcategoriaId: p.subcategoriaId, descricao: l.descricao,
      valor: p.valor, formaPagamento: 'Cartão de Crédito', carteiraId: p.carteiraId,
      isParcela: true, numero: p.numero, qtd: p.qtd,
      transferencia: false,
    });
  });
  return itens;
}
function itensDoMes(ano, mes) {
  return itensTodoPeriodo().filter(i => { const [y, m] = i.data.split('-').map(Number); return y === ano && m === mes; });
}
function totalReceitasMes(ano, mes) {
  return AppLogic.reais(itensDoMes(ano, mes).filter(i => i.tipo === 'Receita').reduce((s, i) => s + AppLogic.centavos(i.valor), 0));
}
function totalDespesasMes(ano, mes) {
  return AppLogic.reais(itensDoMes(ano, mes)
    .filter(i => i.tipo === 'Despesa' && !i.transferencia)
    .reduce((s, i) => s + AppLogic.centavos(i.valor), 0));
}
function saldoTotalContas() {
  return AppLogic.reais(STATE.contas.reduce((s, c) => s + AppLogic.centavos(AppLogic.calcularSaldoConta(c.id, STATE.lancamentos) + (c.saldoInicial || 0)), 0));
}

function mesNavHtml() {
  const { ano, mes } = VIEW;
  return `<div style="display:flex; align-items:center; gap:8px;">
    <button class="btn ghost sm" onclick="Actions.mudarMes(-1)">&larr;</button>
    <div style="min-width:130px; text-align:center; font-weight:600; font-size:13.5px;">${MESES_NOMES[mes]}/${ano}</div>
    <button class="btn ghost sm" onclick="Actions.mudarMes(1)">&rarr;</button>
    <button class="btn ghost sm" onclick="Actions.irParaHoje()">Hoje</button>
  </div>`;
}

function mesesComMovimento() {
  const set = new Set();
  STATE.lancamentos.forEach(l => {
    if (l.formaPagamento === 'Cartão de Crédito') return; // representado pelas parcelas, abaixo
    const [y, m] = l.data.split('-').map(Number); set.add(y + '-' + String(m).padStart(2, '0'));
  });
  STATE.parcelas.forEach(p => { if (p.ano != null && p.mes != null) set.add(p.ano + '-' + String(p.mes).padStart(2, '0')); });
  return Array.from(set).sort();
}

function totalReceitasAcumuladoAno(ano, ateMes) {
  return AppLogic.reais(itensTodoPeriodo().filter(i => { const [y, m] = i.data.split('-').map(Number); return y === ano && m <= ateMes && i.tipo === 'Receita'; }).reduce((s, i) => s + AppLogic.centavos(i.valor), 0));
}
function totalDespesasAcumuladoAno(ano, ateMes) {
  return AppLogic.reais(itensTodoPeriodo().filter(i => { const [y, m] = i.data.split('-').map(Number); return y === ano && m <= ateMes && i.tipo === 'Despesa' && !i.transferencia; }).reduce((s, i) => s + AppLogic.centavos(i.valor), 0));
}
function totalReceitasTodoPeriodo() {
  return AppLogic.reais(itensTodoPeriodo().filter(i => i.tipo === 'Receita').reduce((s, i) => s + AppLogic.centavos(i.valor), 0));
}
function totalDespesasTodoPeriodo() {
  return AppLogic.reais(itensTodoPeriodo().filter(i => i.tipo === 'Despesa' && !i.transferencia).reduce((s, i) => s + AppLogic.centavos(i.valor), 0));
}

function totalParcelasPorMes() {
  const map = {};
  STATE.parcelas.forEach(p => {
    if (p.ano == null || p.mes == null) return;
    const chave = p.ano + '-' + String(p.mes).padStart(2, '0');
    map[chave] = (map[chave] || 0) + AppLogic.centavos(p.valor);
  });
  return Object.entries(map).sort((a, b) => a[0].localeCompare(b[0])).map(([chave, cents]) => {
    const [y, m] = chave.split('-').map(Number);
    return { ano: y, mes: m, valor: AppLogic.reais(cents) };
  });
}

// ---------------- Conferência: pago x fatura, por cartão ----------------
// Descobre a qual cartão um lançamento "💳Pagamento de Fatura" se refere. Lançamentos novos guardam isso
// explicitamente (cartaoFaturaId, escolhido no formulário). Lançamentos antigos (importados da planilha) não
// tinham esse campo — para eles, tentamos casar pelo nome da subcategoria (ex.: "💳Banco do Brasil") com o
// nome do cartão cadastrado, como uma segunda tentativa razoável.
function normalizaNome(s) { return String(s || '').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase(); }
function resolverCartaoDaFatura(l) {
  if (l.cartaoFaturaId != null) {
    const c = STATE.cartoes.find(c => c.id === l.cartaoFaturaId);
    if (c) return c;
  }
  const sub = STATE.subcategorias.find(s => s.id === l.subcategoriaId);
  if (sub) {
    const nomeSub = normalizaNome(sub.nome);
    const achou = STATE.cartoes.find(c => {
      const nomeCartao = normalizaNome(c.nome);
      return nomeCartao && (nomeSub.includes(nomeCartao) || nomeCartao.includes(nomeSub));
    });
    if (achou) return achou;
  }
  return null;
}
// Pago no MESMO mês de competência da fatura — uma compra até o dia do fechamento já "pertence" ao
// mês do vencimento (ex.: compra em 24/06 com fechamento dia 24 vira parcela de competência julho,
// junto com o pagamento da fatura feito em 05/07). Por isso a comparação certa é mês a mês, sem deslocar.
function totalPagoFaturaCartaoMes(cartaoId, ano, mes) {
  return AppLogic.reais(STATE.lancamentos
    .filter(l => l.categoriaId === AppLogic.CATEGORIA_PAGAMENTO_FATURA)
    .filter(l => { const c = resolverCartaoDaFatura(l); return c && c.id === cartaoId; })
    .filter(l => { const [y, m] = l.data.split('-').map(Number); return y === ano && m === mes; })
    .reduce((s, l) => s + AppLogic.centavos(l.valor), 0));
}


// ---------------- Render ----------------
const Render = {
  screen(id) {
    const fn = this['render_' + id];
    if (fn) fn.call(this);
  },

  render_dashboard() {
    const el = document.getElementById('screen-dashboard');
    const { ano, mes } = VIEW;
    const receitas = totalReceitasMes(ano, mes);
    const despesas = totalDespesasMes(ano, mes);
    const economiaPct = receitas > 0 ? Math.round(((receitas - despesas) / receitas) * 100) : 0;
    const ultimos = STATE.lancamentos.slice().sort((a, b) => b.data.localeCompare(a.data)).slice(0, 6);
    const porCategoria = {};
    itensDoMes(ano, mes).filter(i => i.tipo === 'Despesa' && !i.transferencia).forEach(i => {
      porCategoria[i.categoriaId] = (porCategoria[i.categoriaId] || 0) + AppLogic.centavos(i.valor);
    });
    const catRows = Object.entries(porCategoria).sort((a, b) => b[1] - a[1]).map(([cid, cents]) => {
      const pct = despesas > 0 ? Math.round((cents / AppLogic.centavos(despesas)) * 100) : 0;
      return `<div class="legend-item">${CATEGORIA_ICONS[cid] || ''} ${categoriaNome(Number(cid))} — ${pct}%</div>`;
    }).join('');

    el.innerHTML = `
      <div class="topbar"><h1>Painel geral</h1>${mesNavHtml()}</div>
      <div class="grid grid-4">
        <div class="card"><div class="stat-label">Saldo total em contas</div><div class="stat-value">${fmtMoeda(saldoTotalContas())}</div><div class="stat-sub">${STATE.contas.length} contas ativas</div></div>
        <div class="card"><div class="stat-label">Receitas do mês</div><div class="stat-value up">${fmtMoeda(receitas)}</div></div>
        <div class="card"><div class="stat-label">Despesas do mês</div><div class="stat-value down">${fmtMoeda(despesas)}</div></div>
        <div class="card"><div class="stat-label">Economia do mês</div><div class="stat-value" style="color:var(--accent2)">${economiaPct}%</div></div>
      </div>
      <div class="logic-note"><span>ℹ️</span><div>Compras no cartão de crédito entram aqui pelo mês em que a <b>parcela vence</b> (não pelo mês da compra) — assim o valor se aproxima do que realmente compromete sua conta em cada mês. Pagamentos de fatura em si não entram nas despesas, para não contar a mesma compra duas vezes.</div></div>
      <div class="section-title">Gastos por categoria (${MESES_NOMES[mes]})</div>
      <div class="card"><div class="legend">${catRows || '<div class="stat-sub">Sem despesas neste mês.</div>'}</div></div>
      <div class="section-title">Últimos lançamentos</div>
      <div class="card">${ultimos.map(l => `
        <div class="row" style="cursor:pointer;" onclick="Modals.openEditarTransacao('${l.id}')"><div class="row-left"><div class="row-icon">${CATEGORIA_ICONS[l.categoriaId] || ''}</div><div><div class="row-title">${l.descricao}</div><div class="row-sub">${fmtData(l.data)} · ${categoriaNome(l.categoriaId)}</div></div></div>
        <div class="row-value ${l.tipo === 'Receita' ? 'up' : 'down'}">${l.tipo === 'Receita' ? '+' : '-'}${fmtMoeda(l.valor)}</div></div>`).join('') || '<div class="stat-sub">Nenhum lançamento ainda.</div>'}
      </div>
      <div class="fab"><button class="fab-btn" onclick="Modals.openNovaTransacao()">+ Nova transação</button></div>`;
  },

  render_transacoes() {
    const el = document.getElementById('screen-transacoes');
    const { ano, mes } = VIEW;
    const lista = itensDoMes(ano, mes).sort((a, b) => b.data.localeCompare(a.data));
    const receitas = totalReceitasMes(ano, mes), despesas = totalDespesasMes(ano, mes);
    el.innerHTML = `
      <div class="topbar"><h1>Transações</h1>${mesNavHtml()}</div>
      <div class="field-row" style="margin-bottom:16px;">
        <div class="field"><input id="buscaTransacao" placeholder="Buscar por descrição..." oninput="Render.render_transacoes()"></div>
      </div>
      <div class="logic-note"><span>✏️</span><div>Clique em um lançamento na lista abaixo para corrigir ou excluir (útil quando duplicar por engano). Compras no cartão aparecem pelo mês em que cada <b>parcela vence</b>, já com o valor daquela parcela — não o valor total da compra.</div></div>
      <div class="card">${lista.filter(l => {
        const termo = (document.getElementById('buscaTransacao') && document.getElementById('buscaTransacao').value || '').toLowerCase();
        return !termo || l.descricao.toLowerCase().includes(termo);
      }).map(l => {
        const transferencia = l.transferencia;
        return `<div class="row" style="cursor:pointer;" onclick="Modals.openEditarTransacao('${l.lancamentoId}')"><div class="row-left"><div class="row-icon">${CATEGORIA_ICONS[l.categoriaId] || ''}</div><div><div class="row-title">${l.descricao}${l.isParcela && l.qtd > 1 ? ' (parcela ' + l.numero + '/' + l.qtd + ')' : ''}</div><div class="row-sub">${fmtData(l.data)} · ${transferencia ? 'Transferência (não é despesa nova)' : categoriaNome(l.categoriaId) + ' · ' + contaOuCartaoNome(l.carteiraId)}</div></div></div>
        <div class="row-value ${transferencia ? '' : (l.tipo === 'Receita' ? 'up' : 'down')}" style="${transferencia ? 'color:var(--text2)' : ''}">${transferencia ? '' : (l.tipo === 'Receita' ? '+' : '-')}${fmtMoeda(l.valor)}</div></div>`;
      }).join('') || '<div class="stat-sub">Nenhuma transação neste mês.</div>'}
      </div>
      <div class="card" style="display:flex; justify-content:space-between; align-items:center; font-size:13px;">
        <span>Receitas: <b class="up">${fmtMoeda(receitas)}</b></span>
        <span>Despesas: <b class="down">${fmtMoeda(despesas)}</b></span>
        <span>Saldo líquido: <b>${fmtMoeda(receitas - despesas)}</b></span>
        <button class="btn ghost sm" onclick="Actions.exportarCSV('mes')">Exportar Excel (mês)</button>
      </div>
      <div class="fab"><button class="fab-btn" onclick="Modals.openNovaTransacao()">+ Nova transação</button></div>`;
  },

  render_contas() {
    const el = document.getElementById('screen-contas');
    const temNegativa = STATE.contas.some(c => (AppLogic.calcularSaldoConta(c.id, STATE.lancamentos) + (c.saldoInicial || 0)) < 0);
    el.innerHTML = `
      <div class="topbar"><h1>Contas</h1><button class="btn" onclick="Modals.openNovaConta()">+ Nova conta</button></div>
      <div class="grid grid-3">${STATE.contas.map(c => {
        const saldo = AppLogic.calcularSaldoConta(c.id, STATE.lancamentos) + (c.saldoInicial || 0);
        return `<div class="card"><div class="stat-label">${c.nome}</div><div class="stat-value ${saldo<0?'down':''}">${fmtMoeda(saldo)}</div><div class="stat-sub">${c.tipo}</div></div>`;
      }).join('') || '<div class="card stat-sub">Nenhuma conta cadastrada.</div>'}
      </div>
      <div class="section-title">Saldo total</div>
      <div class="card"><div class="stat-value" style="font-size:26px;">${fmtMoeda(saldoTotalContas())}</div><div class="stat-sub">em ${STATE.contas.length} contas ativas</div></div>
      ${temNegativa ? `<div class="logic-note"><span>ℹ️</span><div><b>Saldo negativo aqui não é necessariamente um erro.</b> O saldo de cada conta soma as receitas e subtrai as despesas dos lançamentos importados, sem um "saldo inicial" de partida. Se a planilha original não registrava as transferências entre suas próprias contas (ex.: dinheiro que saía da Conta Corrente e ia pro PIX), a conta de destino aparece artificialmente negativa — o gasto foi real, só a origem do dinheiro não foi registrada. Posso corrigir isso quando quiser, definindo o saldo real de hoje como novo ponto de partida — é só pedir.</div></div>` : ''}`;
  },

  cartoesFiltroMeses: 12,
  setCartoesFiltro(n) { this.cartoesFiltroMeses = n; this.render_cartoes(); },

  render_cartoes() {
    const el = document.getElementById('screen-cartoes');
    const { ano, mes } = VIEW;
    const integridade = verificarIntegridade();
    let comprometido = totalParcelasPorMes();
    if (this.cartoesFiltroMeses !== 'todos') {
      const hoje = new Date();
      const limite = new Date(hoje.getFullYear(), hoje.getMonth() - this.cartoesFiltroMeses, 1);
      comprometido = comprometido.filter(c => new Date(c.ano, c.mes - 1, 1) >= limite);
    }
    const maxComprometido = Math.max(1, ...comprometido.map(c => c.valor));
    el.innerHTML = `
      <div class="topbar"><h1>Cartões de crédito</h1>${mesNavHtml()}<button class="btn" onclick="Modals.openNovoCartao()">+ Novo cartão</button></div>
      <div class="grid grid-2">${STATE.cartoes.map(c => {
        const parcelasCartao = STATE.parcelas.filter(p => p.carteiraId === c.id);
        const fatura = AppLogic.calcularFaturaCartao(parcelasCartao, ano, mes);
        const totalPago = totalPagoFaturaCartaoMes(c.id, ano, mes);
        const diffCents = AppLogic.centavos(totalPago) - AppLogic.centavos(fatura.total);
        const hoje = new Date();
        const mesFuturo = (ano > hoje.getFullYear()) || (ano === hoje.getFullYear() && mes > hoje.getMonth() + 1);
        const vencimentoJaPassou = (ano < hoje.getFullYear())
          || (ano === hoje.getFullYear() && mes < hoje.getMonth() + 1)
          || (ano === hoje.getFullYear() && mes === hoje.getMonth() + 1 && hoje.getDate() >= c.diaVencimento);
        const divergente = !mesFuturo && vencimentoJaPassou && Math.abs(diffCents) > 2;
        const aindaNoPrazo = !mesFuturo && !vencimentoJaPassou;
        return `<div class="card">
          <div class="row-title">💳 ${c.nome}</div>
          <div class="stat-sub" style="margin:4px 0 12px;">Fecha dia ${c.diaFechamento} · Vence dia ${c.diaVencimento}</div>
          <div class="stat-value">${fmtMoeda(fatura.total)}</div>
          <div class="stat-sub">fatura de ${MESES_NOMES[mes]}/${ano}</div>
          <div style="display:flex; align-items:center; gap:6px; margin-top:10px; padding:8px 10px; background:#0e1f16; border:1px solid #1c4c2e; border-radius:8px; font-size:12px; color:var(--green);">
            <span>✓</span><span>Fatura = soma automática das ${fatura.itens.length} parcela(s) com competência neste mês (compras feitas até o fechamento anterior ao vencimento de ${MESES_NOMES[mes]})</span>
          </div>
          <button class="btn ghost sm" style="margin-top:12px;" onclick="Modals.toggleDetail('${c.id}')">Ver detalhamento</button>
          <div id="detail-${c.id}" style="display:none; margin-top:12px;">
            <table class="table"><tr><th>Lançamento</th><th>Parcela</th><th>Valor</th></tr>
            ${fatura.itens.map(it => {
              const l = STATE.lancamentos.find(x => x.id === it.lancamentoId);
              return `<tr><td>${l ? l.descricao : it.lancamentoId}</td><td>${it.numero} de ${it.qtd}</td><td>${fmtMoeda(it.valor)}</td></tr>`;
            }).join('')}
            <tr style="font-weight:600;"><td>Soma</td><td></td><td>${fmtMoeda(fatura.total)}</td></tr>
            </table>
          </div>
          ${mesFuturo ? '' : `
          <div class="section-title" style="margin:16px 0 6px; font-size:12.5px;">Conferência de pagamento — fatura de ${MESES_NOMES[mes]}/${ano} (vence dia ${c.diaVencimento})</div>
          <div class="row" style="padding:6px 0;"><div class="row-sub">Fatura deste mês</div><div class="row-value">${fmtMoeda(fatura.total)}</div></div>
          <div class="row" style="padding:6px 0;"><div class="row-sub">Pago (Pagamento de Fatura) neste mês</div><div class="row-value">${fmtMoeda(totalPago)}</div></div>
          ${divergente
            ? `<div class="banner warn" style="margin-top:6px;"><span>⚠️</span><div><b>Diferença de ${fmtMoeda(Math.abs(diffCents / 100))}</b> — ${diffCents > 0 ? 'pago a mais do que o valor desta fatura' : 'da fatura sem pagamento registrado'}. Confira se falta lançar o "💳Pagamento de Fatura" deste cartão em ${MESES_NOMES[mes]}, ou se algum valor foi digitado errado.</div></div>`
            : aindaNoPrazo
              ? `<div style="display:flex; align-items:center; gap:6px; margin-top:6px; padding:8px 10px; background:#101b2e; border:1px dashed #2e4468; border-radius:8px; font-size:12px; color:#8fb4e8;"><span>ℹ️</span><span>Ainda dentro do prazo — vence dia ${c.diaVencimento}, sem problema se o pagamento ainda não foi lançado.</span></div>`
              : `<div style="display:flex; align-items:center; gap:6px; margin-top:6px; padding:8px 10px; background:#0e1f16; border:1px solid #1c4c2e; border-radius:8px; font-size:12px; color:var(--green);"><span>✓</span><span>Pago bate com a fatura deste mês</span></div>`}
          `}
        </div>`;
      }).join('') || '<div class="card stat-sub">Nenhum cartão cadastrado.</div>'}
      </div>
      <div class="section-title">Valor comprometido em cartão por mês (todos os cartões, passado e futuro)</div>
      <div class="tabs" style="margin-bottom:10px;">
        <div class="tab ${this.cartoesFiltroMeses===6?'active':''}" onclick="Render.setCartoesFiltro(6)">Últimos 6 meses</div>
        <div class="tab ${this.cartoesFiltroMeses===12?'active':''}" onclick="Render.setCartoesFiltro(12)">Últimos 12 meses</div>
        <div class="tab ${this.cartoesFiltroMeses==='todos'?'active':''}" onclick="Render.setCartoesFiltro('todos')">Todo o período</div>
      </div>
      <div class="card">
        <div class="bars" style="height:130px;">
          ${comprometido.map(c => `<div class="bar-col">
            <div class="bar-value">${fmtMoeda(c.valor)}</div>
            <div class="bar" style="height:${Math.max(4, Math.round((c.valor / maxComprometido) * 100))}%; background:var(--accent)"></div>
            <div class="bar-label">${String(c.mes).padStart(2,'0')}/${String(c.ano).slice(2)}</div>
          </div>`).join('') || '<div class="stat-sub">Nenhuma parcela cadastrada ainda.</div>'}
        </div>
        <div class="stat-sub" style="margin-top:8px;">Cada barra soma as parcelas de todos os cartões com competência naquele mês — inclui parcelamentos ainda não vencidos, então mostra o que já está comprometido à frente, mês a mês.</div>
      </div>
      <div class="logic-note"><span>ℹ️</span><div>Auditoria de integridade: <b>${integridade.ok} de ${integridade.total}</b> lançamentos de cartão conferem exatamente com a soma de suas parcelas.${integridade.divergentes.length ? ' Divergências: ' + integridade.divergentes.map(d => d.id).join(', ') : ' Nenhuma divergência encontrada.'}</div></div>`;
  },

  render_categorias() {
    const el = document.getElementById('screen-categorias');
    el.innerHTML = `
      <div class="topbar"><h1>Categorias e subcategorias</h1></div>
      <div class="logic-note"><span>ℹ️</span><div>As categorias abaixo vêm da sua planilha e não podem ser excluídas (só desativadas), para preservar seu histórico.</div></div>
      ${STATE.categorias.map(cat => {
        const subs = STATE.subcategorias.filter(s => s.categoriaId === cat.id);
        return `<div class="card" style="margin-bottom:10px;">
          <div class="row-title" style="margin-bottom:10px;">${CATEGORIA_ICONS[cat.id] || ''} ${cat.nome}</div>
          <div style="display:flex; flex-wrap:wrap; gap:8px;">
            ${subs.map(s => `<span class="chip">${s.nome}</span>`).join('')}
            <span class="chip" style="border-style:dashed;" onclick="Modals.openNovaSubcategoria(${cat.id})">+ nova subcategoria</span>
          </div>
        </div>`;
      }).join('')}`;
  },

  render_orcamentos() {
    const el = document.getElementById('screen-orcamentos');
    const { ano, mes } = VIEW;
    const linhas = AppLogic.calcularOrcadoRealizado(STATE.lancamentos, STATE.orcamentos, ano, mes, STATE.parcelas);
    const porCategoria = {};
    linhas.forEach(l => {
      porCategoria[l.categoriaId] = porCategoria[l.categoriaId] || { orcado: 0, realizado: 0, subs: [] };
      porCategoria[l.categoriaId].orcado += AppLogic.centavos(l.orcado);
      porCategoria[l.categoriaId].realizado += AppLogic.centavos(l.realizado);
      porCategoria[l.categoriaId].subs.push(l);
    });
    const estourados = linhas.filter(l => l.status === 'estourado');
    el.innerHTML = `
      <div class="topbar"><h1>Orçamentos</h1>${mesNavHtml()}</div>
      ${estourados.length ? `<div class="banner warn"><span>⚠️</span><div><b>${estourados.length} subcategoria(s) estouraram o orçamento este mês:</b> ${estourados.map(e => subcategoriaNome(e.subcategoriaId) + ' (' + e.pct + '%)').join(', ')}. Veja o relatório completo em Relatórios.</div></div>` : ''}
      <div class="card">
        ${Object.entries(porCategoria).map(([cid, agg]) => {
          const pct = agg.orcado > 0 ? Math.round((agg.realizado / agg.orcado) * 100) : 0;
          const cor = pct > 100 ? 'var(--red)' : (pct >= 90 ? 'var(--amber)' : 'var(--green)');
          const catId = Number(cid);
          return `<div class="row" style="cursor:pointer;" onclick="Modals.toggleOrc(${catId})">
            <div style="flex:1;">
              <div class="row-title">${CATEGORIA_ICONS[catId] || ''} ${categoriaNome(catId)} <span id="arrow-${catId}" style="color:var(--text3); font-size:11px;">▸ ver subcategorias</span></div>
              <div class="progress"><div class="progress-fill" style="width:${Math.min(pct,100)}%; background:${cor}"></div></div>
              <div class="stat-sub" style="margin-top:5px;">Realizado ${fmtMoeda(agg.realizado/100)} de ${fmtMoeda(agg.orcado/100)} orçado (${pct}%)${pct>100?' — estourado':''}</div>
            </div></div>
          <div id="orc-${catId}" style="display:none; margin:2px 0 6px; border-left:2px solid var(--border); padding-left:2px;">
            ${agg.subs.map(s => `<div class="row" style="padding:8px 0 8px 14px;"><div style="flex:1;">
              <div class="row-sub" style="margin-bottom:4px;">${subcategoriaNome(s.subcategoriaId)}</div>
              <div class="progress" style="height:6px;"><div class="progress-fill" style="width:${Math.min(s.pct,100)}%; background:${s.status==='estourado'?'var(--red)':(s.status==='atencao'?'var(--amber)':'var(--green)')}"></div></div>
              <div class="stat-sub" style="margin-top:4px;">${fmtMoeda(s.realizado)} de ${fmtMoeda(s.orcado)} orçado (${s.pct}%)</div>
            </div></div>`).join('')}
          </div>`;
        }).join('') || '<div class="stat-sub">Nenhum orçamento definido para este mês.</div>'}
      </div>
      <div class="logic-note"><span>ℹ️</span><div>"Pagamento de Fatura" não entra aqui de propósito — já tratado como transferência, evitando dupla contagem.</div></div>`;
  },

  render_metas() {
    const el = document.getElementById('screen-metas');
    el.innerHTML = `
      <div class="topbar"><h1>Metas financeiras</h1><button class="btn" onclick="Modals.openNovaMeta()">+ Nova meta</button></div>
      <div class="grid grid-3">${STATE.metas.map(m => {
        const pct = m.valorAlvo > 0 ? Math.round((m.valorAtual / m.valorAlvo) * 100) : 0;
        return `<div class="card"><div style="font-size:26px; margin-bottom:8px;">${m.icone}</div>
          <div class="row-title">${m.nome}</div>
          <div class="progress"><div class="progress-fill" style="width:${Math.min(pct,100)}%; background:${pct>=100?'var(--green)':'var(--accent)'}"></div></div>
          <div class="stat-sub" style="margin-top:6px;">${fmtMoeda(m.valorAtual)} de ${fmtMoeda(m.valorAlvo)}${m.prazo ? ' · ' + m.prazo : ''}</div>
        </div>`;
      }).join('') || '<div class="card stat-sub">Nenhuma meta cadastrada ainda.</div>'}
      </div>
      <div class="logic-note"><span>ℹ️</span><div>Uma meta é marcada como concluída automaticamente quando o valor guardado atinge o valor-alvo.</div></div>`;
  },

  render_investimentos() {
    const el = document.getElementById('screen-investimentos');
    const totalAtual = AppLogic.reais(STATE.investimentos.reduce((s, i) => s + AppLogic.centavos(i.valorAtual), 0));
    const totalAportado = AppLogic.reais(STATE.investimentos.reduce((s, i) => s + AppLogic.centavos(i.valorAportado), 0));

    const CATEGORIA_INVESTIMENTO = 5;
    const lancsInv = STATE.lancamentos.filter(l => l.categoriaId === CATEGORIA_INVESTIMENTO);
    const aportesFluxo = AppLogic.reais(lancsInv.filter(l => l.tipo === 'Despesa').reduce((s, l) => s + AppLogic.centavos(l.valor), 0));
    const recebidoFluxo = AppLogic.reais(lancsInv.filter(l => l.tipo === 'Receita').reduce((s, l) => s + AppLogic.centavos(l.valor), 0));
    const saldoFluxo = AppLogic.reais(AppLogic.centavos(aportesFluxo) - AppLogic.centavos(recebidoFluxo));

    el.innerHTML = `
      <div class="topbar"><h1>Investimentos</h1><button class="btn" onclick="Modals.openNovoAtivo()">+ Novo ativo</button></div>

      <div class="section-title">Resumo pelo fluxo de caixa (automático, a partir dos seus lançamentos)</div>
      <div class="grid grid-3">
        <div class="card"><div class="stat-label">Total aportado (despesas)</div><div class="stat-value down">${fmtMoeda(aportesFluxo)}</div><div class="stat-sub">${lancsInv.filter(l=>l.tipo==='Despesa').length} lançamentos</div></div>
        <div class="card"><div class="stat-label">Recebido em rendimentos/retiradas</div><div class="stat-value up">${fmtMoeda(recebidoFluxo)}</div><div class="stat-sub">${lancsInv.filter(l=>l.tipo==='Receita').length} lançamentos</div></div>
        <div class="card"><div class="stat-label">Saldo líquido investido</div><div class="stat-value">${fmtMoeda(saldoFluxo)}</div><div class="stat-sub">aportado − recebido de volta</div></div>
      </div>
      <div class="logic-note"><span>ℹ️</span><div>Este resumo é calculado automaticamente a partir dos lançamentos que você já faz na categoria "Investimento" (aporte = despesa, rendimento ou retirada = receita) — nada para digitar de novo aqui. Ele mostra <b>quanto dinheiro saiu e voltou da sua conta</b>, não o valor de mercado atual do investimento (isso nenhum app descobre sozinho — só seu extrato do banco sabe).</div></div>

      <div class="section-title">Seus ativos (cadastro manual, para acompanhar valor de mercado)</div>
      <div class="grid grid-4">
        <div class="card"><div class="stat-label">Patrimônio atual</div><div class="stat-value">${fmtMoeda(totalAtual)}</div></div>
        <div class="card"><div class="stat-label">Total aportado (cadastrado)</div><div class="stat-value">${fmtMoeda(totalAportado)}</div></div>
        <div class="card"><div class="stat-label">Rentabilidade</div><div class="stat-value ${totalAtual>=totalAportado?'up':'down'}">${totalAportado>0?(((totalAtual-totalAportado)/totalAportado)*100).toFixed(1):'0.0'}%</div></div>
        <div class="card"><div class="stat-label">Ativos</div><div class="stat-value">${STATE.investimentos.length}</div></div>
      </div>
      <table class="table"><tr><th>Nome</th><th>Tipo</th><th>Aportado</th><th>Valor atual</th></tr>
      ${STATE.investimentos.map(i => `<tr><td>${i.nome}</td><td>${i.tipo}</td><td>${fmtMoeda(i.valorAportado)}</td><td>${fmtMoeda(i.valorAtual)}</td></tr>`).join('') || '<tr><td colspan="4" class="stat-sub">Nenhum ativo cadastrado ainda — clique em "+ Novo ativo" e use o resumo acima como referência do que já foi aportado.</td></tr>'}
      </table>`;
  },

  relatorioModo: 'mensal',
  setRelatorioModo(m) { this.relatorioModo = m; this.render_relatorios(); },
  relatorioJanela: 12,
  setRelatorioJanela(n) { this.relatorioJanela = n; this.render_relatorios(); },

  render_relatorios() {
    const el = document.getElementById('screen-relatorios');
    const { ano, mes } = VIEW;
    const modo = this.relatorioModo;

    let receitas, despesas, labelPeriodo;
    if (modo === 'mensal') { receitas = totalReceitasMes(ano, mes); despesas = totalDespesasMes(ano, mes); labelPeriodo = MESES_NOMES[mes] + '/' + ano; }
    else if (modo === 'anual') { receitas = totalReceitasAcumuladoAno(ano, mes); despesas = totalDespesasAcumuladoAno(ano, mes); labelPeriodo = 'Jan a ' + MESES_NOMES[mes] + '/' + ano + ' (acumulado no ano)'; }
    else { receitas = totalReceitasTodoPeriodo(); despesas = totalDespesasTodoPeriodo(); labelPeriodo = 'Todo o período do seu histórico'; }

    const linhas = AppLogic.calcularOrcadoRealizado(STATE.lancamentos, STATE.orcamentos, ano, mes, STATE.parcelas);
    // Mesma base (itens por competência de parcela) usada nos totais acima, para "maior gasto individual"
    // não citar uma compra de um mês diferente do que está sendo exibido.
    const universo = modo === 'mensal' ? itensDoMes(ano, mes)
      : modo === 'anual' ? itensTodoPeriodo().filter(i => { const [y, m] = i.data.split('-').map(Number); return y === ano && m <= mes; })
      : itensTodoPeriodo();
    const maiorGasto = universo.filter(i => i.tipo === 'Despesa' && !i.transferencia).sort((a, b) => b.valor - a.valor)[0];

    function badge(status) {
      if (status === 'estourado') return '<span style="color:var(--red); font-weight:600;">Estourado</span>';
      if (status === 'atencao') return '<span style="color:var(--amber); font-weight:600;">Atenção</span>';
      return '<span style="color:var(--green); font-weight:600;">OK</span>';
    }

    const meses = mesesComMovimento();
    const evolucao = meses.map(chave => {
      const [y, m] = chave.split('-').map(Number);
      return { chave, y, m, receita: totalReceitasMes(y, m), despesa: totalDespesasMes(y, m) };
    });
    // O acumulado (saldo corrido) precisa ser calculado sobre TODO o histórico, sem cortes — senão o
    // valor de cada barra ficaria errado (recomeçaria do zero na borda da janela visível). O corte por
    // período abaixo só afeta QUANTAS barras aparecem na tela, não a conta em si.
    let saldoAcum = 0;
    const acumulado = evolucao.map(e => { saldoAcum += (e.receita - e.despesa); return { ...e, acumulado: AppLogic.reais(AppLogic.centavos(saldoAcum)) }; });

    // Janela de exibição dos dois gráficos abaixo — evita dezenas de barras espremidas no quadro.
    // Por padrão mostra uma janela centrada no mês atual (metade passado, metade futuro, quando existir
    // histórico/parcelamento futuro); "Todo o período" remove o corte.
    const janelaN = this.relatorioJanela;
    let janela = acumulado;
    if (janelaN !== 'todos' && acumulado.length > janelaN) {
      const hoje = new Date();
      const chaveHoje = hoje.getFullYear() + '-' + String(hoje.getMonth() + 1).padStart(2, '0');
      const idxHoje = acumulado.findIndex(e => e.chave >= chaveHoje);
      const centro = idxHoje === -1 ? acumulado.length : idxHoje;
      let ini = Math.max(0, centro - Math.ceil(janelaN / 2));
      let fim = Math.min(acumulado.length, ini + janelaN);
      if (fim - ini < janelaN) ini = Math.max(0, fim - janelaN);
      janela = acumulado.slice(ini, fim);
    }
    const maxVal = Math.max(1, ...janela.map(e => Math.max(e.receita, e.despesa)));
    const maxAcum = Math.max(1, ...janela.map(e => Math.abs(e.acumulado)));

    el.innerHTML = `
      <div class="topbar"><h1>Relatórios</h1>${mesNavHtml()}</div>
      <div class="tabs">
        <div class="tab ${modo === 'mensal' ? 'active' : ''}" onclick="Render.setRelatorioModo('mensal')">Mensal</div>
        <div class="tab ${modo === 'anual' ? 'active' : ''}" onclick="Render.setRelatorioModo('anual')">Acumulado no ano</div>
        <div class="tab ${modo === 'total' ? 'active' : ''}" onclick="Render.setRelatorioModo('total')">Todo o período</div>
      </div>
      <div class="stat-sub" style="margin-bottom:10px;">Período: <b>${labelPeriodo}</b></div>
      <div class="grid grid-4">
        <div class="card"><div class="stat-label">Total recebido</div><div class="stat-value up">${fmtMoeda(receitas)}</div></div>
        <div class="card"><div class="stat-label">Total gasto</div><div class="stat-value down">${fmtMoeda(despesas)}</div></div>
        <div class="card"><div class="stat-label">Saldo líquido</div><div class="stat-value">${fmtMoeda(receitas-despesas)}</div></div>
        <div class="card"><div class="stat-label">Maior gasto individual</div><div class="stat-value" style="font-size:15px;">${maiorGasto ? maiorGasto.descricao + ' — ' + fmtMoeda(maiorGasto.valor) : '—'}</div></div>
      </div>

      <div style="display:flex; gap:10px; margin-bottom:6px;">
        <button class="btn ghost sm" onclick="Actions.exportarCSV('mes')">Exportar Excel — mês selecionado</button>
        <button class="btn ghost sm" onclick="Actions.exportarCSV('tudo')">Exportar Excel — todo o período</button>
      </div>
      <div class="section-title">Evolução mês a mês${janelaN === 'todos' ? ' (todo o histórico com movimento)' : ''}</div>
      <div class="tabs" style="margin-bottom:10px;">
        <div class="tab ${janelaN===6?'active':''}" onclick="Render.setRelatorioJanela(6)">6 meses</div>
        <div class="tab ${janelaN===12?'active':''}" onclick="Render.setRelatorioJanela(12)">12 meses</div>
        <div class="tab ${janelaN===24?'active':''}" onclick="Render.setRelatorioJanela(24)">24 meses</div>
        <div class="tab ${janelaN==='todos'?'active':''}" onclick="Render.setRelatorioJanela('todos')">Todo o período</div>
      </div>
      <div class="card">
        <div class="bars" style="height:130px;">
          ${janela.map(e => `<div class="bar-col">
            <div class="bar-value">${fmtMoeda(e.despesa)}</div>
            <div class="bar" style="height:${Math.round((e.despesa/maxVal)*100)}%; background:var(--red)"></div>
            <div class="bar-label">${String(e.m).padStart(2,'0')}/${String(e.y).slice(2)}</div>
          </div>`).join('')}
        </div>
        <div class="stat-sub" style="margin-top:8px;">Barras vermelhas = despesa do mês. Toque em "Mensal" acima e use as setas para abrir um mês específico. Quer ver mais meses (passado ou futuro)? Escolha um período maior acima.</div>
      </div>

      <div class="section-title">Saldo acumulado (receitas − despesas, mês a mês)</div>
      <div class="card">
        <div class="bars-zero">
          ${janela.map(e => {
            const isPos = e.acumulado >= 0;
            const pct = Math.max(4, Math.round((Math.abs(e.acumulado) / maxAcum) * 100));
            return `<div class="bar-col-zero">
              <div class="bar-zero-top">${isPos ? `<div class="bar-value">${fmtMoeda(e.acumulado)}</div><div class="bar-d" style="height:${pct}%; background:var(--green)"></div>` : ''}</div>
              <div class="bar-zero-axis"></div>
              <div class="bar-zero-bottom">${!isPos ? `<div class="bar-d" style="height:${pct}%; background:var(--red)"></div><div class="bar-value">${fmtMoeda(e.acumulado)}</div>` : ''}</div>
              <div class="bar-label">${String(e.m).padStart(2,'0')}/${String(e.y).slice(2)}</div>
            </div>`;
          }).join('')}
        </div>
        <div class="stat-sub" style="margin-top:8px;">Barras acima da linha = saldo positivo acumulado até aquele mês; abaixo = negativo (mesmo período selecionado acima). Saldo acumulado no último mês do histórico: <b>${fmtMoeda(acumulado.length ? acumulado[acumulado.length-1].acumulado : 0)}</b></div>
      </div>

      <div class="section-title">Orçado x realizado por subcategoria (mês selecionado: ${MESES_NOMES[mes]}/${ano})</div>
      <div class="logic-note"><span>ℹ️</span><div>Este comparativo é sempre por mês (orçamento é definido mês a mês) — use as setas no topo para trocar o mês.</div></div>
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
        <div class="toggle" id="filtroEstouro" onclick="Modals.toggleFiltroRelatorio(this)"><div class="knob"></div></div>
        <span class="stat-sub">Mostrar apenas subcategorias estouradas</span>
      </div>
      <table class="table" id="tabelaOrcRealizado"><tr><th>Subcategoria</th><th>Categoria</th><th>Orçado</th><th>Realizado</th><th>% do orçado</th><th>Status</th></tr>
      ${linhas.map(l => `<tr class="rel-row" data-pct="${l.pct}"><td>${subcategoriaNome(l.subcategoriaId)}</td><td class="row-sub">${categoriaNome(l.categoriaId)}</td><td>${fmtMoeda(l.orcado)}</td><td>${fmtMoeda(l.realizado)}</td><td>${l.pct}%</td><td>${badge(l.status)}</td></tr>`).join('') || '<tr><td colspan="6" class="stat-sub">Sem orçamento definido neste mês.</td></tr>'}
      </table>`;
  },

  render_chatia() {
    const el = document.getElementById('screen-chatia');
    const ativo = STATE.config.chatIA;
    document.getElementById('chatia-badge').textContent = ativo ? 'ON' : 'OFF';
    el.innerHTML = `
      <div class="topbar"><h1>Chat IA</h1></div>
      <div class="banner warn"><span>⚠️</span><div>Este recurso está <b>${ativo ? 'ativo' : 'desligado'}</b>. Quando ativo, os dados que você escolher enviar saem do seu dispositivo e passam pela infraestrutura da Anthropic (Claude). Nada é enviado automaticamente.</div></div>
      <div class="card" style="margin-bottom:16px;">
        <div class="row"><div><div class="row-title">Ativar Chat IA</div><div class="row-sub">Você pode desligar a qualquer momento em Configurações</div></div>
        <div class="toggle ${ativo ? 'on' : ''}" onclick="Actions.toggleChatIA()"><div class="knob"></div></div></div>
      </div>
      ${ativo ? `
      <div class="row" style="border:none; margin-bottom:14px;"><div><div class="row-title">Modo agregado</div><div class="row-sub">Enviar apenas totais por categoria, sem descrições individuais</div></div>
        <div class="toggle ${STATE.config.modoAgregado ? 'on' : ''}" onclick="Actions.toggleModoAgregado()"><div class="knob"></div></div></div>
      <div class="card" style="border-color:#5c3a12;">
        <div class="row-title" style="margin-bottom:8px;">📤 Este recurso ainda não envia dados de verdade nesta versão</div>
        <div class="stat-sub">Módulo isolado reservado para a Fase 7 do plano — a interface de consentimento já está pronta, a integração com a API é feita depois, com sua aprovação explícita de cada envio.</div>
      </div>` : ''}
      <div class="logic-note"><span>ℹ️</span><div>Nada é enviado até você confirmar, depois de ver exatamente o que seria compartilhado.</div></div>`;
  },

  render_config() {
    const el = document.getElementById('screen-config');
    const integridade = verificarIntegridade();
    el.innerHTML = `
      <div class="topbar"><h1>Configurações</h1></div>
      <div class="card" style="margin-bottom:10px;">
        <div class="row"><div><div class="row-title">Bloqueio automático</div><div class="row-sub">Pedir PIN após inatividade</div></div>
          <select onchange="Actions.setBloqueio(this.value)">
            <option value="5" ${STATE.config.bloqueioMin===5?'selected':''}>5 minutos</option>
            <option value="10" ${STATE.config.bloqueioMin===10?'selected':''}>10 minutos</option>
            <option value="0" ${STATE.config.bloqueioMin===0?'selected':''}>Nunca</option>
          </select></div>
      </div>
      <div class="card" style="margin-bottom:10px;">
        <div class="row"><div><div class="row-title">Gerar backup</div><div class="row-sub">Arquivo criptografado (.json)</div></div><button class="btn ghost sm" onclick="Actions.exportBackup()">Gerar</button></div>
        <div class="row"><div><div class="row-title">Restaurar backup</div><div class="row-sub">A partir de um arquivo salvo</div></div>
          <input type="file" id="fileRestore" style="display:none" onchange="Actions.importBackup(this.files[0])">
          <button class="btn ghost sm" onclick="document.getElementById('fileRestore').click()">Restaurar</button></div>
      </div>
      <div class="card" style="margin-bottom:10px;">
        <div class="row-title" style="margin-bottom:8px;">Sincronização automática (Chrome/Edge no computador)</div>
        <div id="syncConfigBody"><div class="stat-sub">Carregando status...</div></div>
      </div>
      <div class="card" style="margin-bottom:10px;">
        <div class="row-title" style="margin-bottom:8px;">Sincronizar agora (funciona em qualquer navegador, inclusive celular)</div>
        <div class="stat-sub" style="margin-bottom:10px;">Gera um arquivo com os dados atuais para você salvar na pasta do OneDrive, ou carrega um arquivo salvo por outro aparelho. Não depende de nenhum recurso especial do navegador — funciona em qualquer um.</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn ghost sm" onclick="Actions.baixarSync()">Baixar arquivo para sincronizar</button>
          <input type="file" id="fileSyncManual" style="display:none" onchange="Modals.abrirSyncManual(this.files[0])">
          <button class="btn ghost sm" onclick="document.getElementById('fileSyncManual').click()">Carregar arquivo sincronizado</button>
        </div>
      </div>
      <div class="card" style="margin-bottom:10px;">
        <div class="row"><div class="row-title">Integridade dos dados</div><div class="row-value" style="color:${integridade.divergentes.length?'var(--red)':'var(--green)'}">${integridade.ok}/${integridade.total} conferem</div></div>
      </div>
      <div class="card">
        <div class="row"><div><div class="row-title" style="color:#f87171;">Zerar dados</div><div class="row-sub">Apaga tudo permanentemente</div></div><button class="btn danger sm" onclick="Actions.zerarDados()">Zerar</button></div>
      </div>`;
    this.fillSyncCard();
  },

  async fillSyncCard() {
    const body = document.getElementById('syncConfigBody');
    if (!body) return;
    if (!AppSync.supported()) {
      body.innerHTML = `<div class="stat-sub">Seu navegador não suporta sincronização automática. Use Google Chrome ou Microsoft Edge para esse recurso (o resto do app funciona normalmente).</div>`;
      return;
    }
    const ativo = await AppSync.isEnabled();
    if (ativo) {
      const nome = await AppSync.nomeArquivo();
      body.innerHTML = `
        <div class="row" style="border:none; padding:0 0 10px;">
          <div><div class="row-title" style="color:var(--green);">Ativa ✓</div><div class="row-sub">Arquivo: ${nome || 'dados-sincronizados.kfsync'} — salvo automaticamente a cada alteração</div></div>
        </div>
        <button class="btn ghost sm" onclick="Sync.desativar()">Desativar sincronização</button>`;
    } else {
      body.innerHTML = `
        <div class="stat-sub" style="margin-bottom:10px;">Mantenha os mesmos dados atualizados no notebook e no celular automaticamente, usando um arquivo dentro da sua pasta do OneDrive. Nada é enviado a nenhum servidor além do OneDrive que você já usa.</div>
        <div style="display:flex; gap:10px; flex-wrap:wrap;">
          <button class="btn sm" onclick="Sync.ativar()">Criar arquivo de sincronização</button>
          <button class="btn ghost sm" onclick="Sync.vincularExistente()">Já existe um arquivo (vincular)</button>
        </div>`;
    }
  },
};

// ---------------- Modals ----------------
const Modals = {
  open(id) { document.getElementById('overlay-' + id).classList.add('active'); },
  close(id) { document.getElementById('overlay-' + id).classList.remove('active'); },

  toggleDetail(id) {
    const el = document.getElementById('detail-' + id);
    el.style.display = (el.style.display === 'none' || !el.style.display) ? 'block' : 'none';
  },
  toggleOrc(id) {
    const el = document.getElementById('orc-' + id);
    const arrow = document.getElementById('arrow-' + id);
    const isOpen = el.style.display === 'block';
    el.style.display = isOpen ? 'none' : 'block';
    arrow.textContent = isOpen ? '▸ ver subcategorias' : '▾ ocultar subcategorias';
  },
  toggleFiltroRelatorio(elToggle) {
    elToggle.classList.toggle('on');
    const on = elToggle.classList.contains('on');
    document.querySelectorAll('.rel-row').forEach(r => {
      const pct = parseFloat(r.getAttribute('data-pct'));
      r.style.display = (on && pct <= 100) ? 'none' : '';
    });
  },

  openNovaTransacao() {
    const catOpts = STATE.categorias.map(c => `<option value="${c.id}">${CATEGORIA_ICONS[c.id]||''} ${c.nome}</option>`).join('');
    const contaOpts = STATE.cartoes.map(c => `<option value="cartao_${c.id}">${c.nome}</option>`)
      .concat(STATE.contas.map(c => `<option value="conta_${c.id}">${c.nome}</option>`)).join('');
    const cartaoFaturaOpts = STATE.cartoes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
    document.getElementById('modalNovaTransacaoBody').innerHTML = `
      <div class="modal-head"><h3>Nova transação</h3><button class="close-x" onclick="Modals.close('novaTransacao')">✕</button></div>
      <div class="tabs">
        <div class="tab active" id="tabDespesa" style="flex:1; text-align:center; background:#3d1414; color:#f87171;" onclick="Modals.setTipoTransacao('Despesa')">Despesa</div>
        <div class="tab" id="tabReceita" style="flex:1; text-align:center;" onclick="Modals.setTipoTransacao('Receita')">Receita</div>
      </div>
      <input type="hidden" id="ntTipo" value="Despesa">
      <div class="field"><label>Descrição</label><input id="ntDescricao" placeholder="Ex: Supermercado, Salário..."></div>
      <div class="field-row">
        <div class="field"><label>Valor (R$)</label><input id="ntValor" type="number" step="0.01" placeholder="0,00"></div>
        <div class="field"><label>Data</label><input id="ntData" type="date" value="${VIEW.ano}-${String(VIEW.mes).padStart(2,'0')}-01"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Categoria</label><select id="ntCategoria" onchange="Modals.refreshSubcategorias(); Modals.refreshCampoCartaoFatura('nt')">${catOpts}</select></div>
        <div class="field"><label>Subcategoria</label><select id="ntSubcategoria"></select></div>
      </div>
      <div class="field"><label>Conta ou cartão</label><select id="ntConta" onchange="Modals.refreshParcelas()">${contaOpts}</select></div>
      <div class="field" id="ntCampoCartaoFatura" style="display:none;"><label>Qual cartão esta fatura está pagando?</label><select id="ntCartaoFatura">${cartaoFaturaOpts}</select></div>
      <div class="field" id="campoParcelas" style="display:none;"><label>Número de parcelas</label>
        <select id="ntParcelas" onchange="Modals.calcParcelasPreview()">
          ${parcelaOptionsHtml()}
        </select></div>
      <div id="parcelasPreview" class="logic-note" style="margin-top:0; display:none;"></div>
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Actions.salvarTransacao()">Lançar</button>`;
    Modals.refreshSubcategorias();
    Modals.refreshParcelas();
    Modals.refreshCampoCartaoFatura('nt');
    Modals.open('novaTransacao');
  },
  setTipoTransacao(tipo) {
    document.getElementById('ntTipo').value = tipo;
    document.getElementById('tabDespesa').style.background = tipo === 'Despesa' ? '#3d1414' : '';
    document.getElementById('tabDespesa').style.color = tipo === 'Despesa' ? '#f87171' : '';
    document.getElementById('tabReceita').style.background = tipo === 'Receita' ? '#0e2f1c' : '';
    document.getElementById('tabReceita').style.color = tipo === 'Receita' ? '#4ade80' : '';
  },
  refreshSubcategorias() {
    const catId = Number(document.getElementById('ntCategoria').value);
    const subs = STATE.subcategorias.filter(s => s.categoriaId === catId);
    document.getElementById('ntSubcategoria').innerHTML = subs.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  },
  refreshCampoCartaoFatura(prefixo) {
    const catId = Number(document.getElementById(prefixo + 'Categoria').value);
    const campo = document.getElementById(prefixo + 'CampoCartaoFatura');
    if (campo) campo.style.display = (catId === AppLogic.CATEGORIA_PAGAMENTO_FATURA) ? 'block' : 'none';
  },
  refreshParcelas() {
    const val = document.getElementById('ntConta').value;
    const isCartao = val.startsWith('cartao_');
    document.getElementById('campoParcelas').style.display = isCartao ? 'block' : 'none';
    document.getElementById('parcelasPreview').style.display = isCartao ? 'block' : 'none';
    if (isCartao) Modals.calcParcelasPreview();
  },
  calcParcelasPreview() {
    const n = parseInt(document.getElementById('ntParcelas').value, 10);
    const valor = parseFloat(document.getElementById('ntValor').value) || 0;
    const box = document.getElementById('parcelasPreview');
    if (!valor) { box.innerHTML = '<span>ℹ️</span><div>Informe o valor para ver a prévia das parcelas.</div>'; return; }
    const data = document.getElementById('ntData').value;
    const contaId = document.getElementById('ntConta').value.replace('cartao_', '');
    const cartao = STATE.cartoes.find(c => String(c.id) === contaId);
    if (!cartao) { box.innerHTML = ''; return; }
    const parcelas = AppLogic.gerarParcelas(valor, n, data, cartao.diaFechamento, cartao.diaVencimento);
    if (n === 1) { box.innerHTML = '<span>ℹ️</span><div>Compra à vista — valor total debitado na fatura de ' + MESES_NOMES[parcelas[0].mes] + '/' + parcelas[0].ano + '.</div>'; return; }
    box.innerHTML = '<span>ℹ️</span><div><b>Prévia automática:</b><br>' + parcelas.map(p => `Parcela ${p.numero}/${p.qtd}: ${fmtMoeda(p.valor)} — ${MESES_NOMES[p.mes]}/${p.ano}`).join('<br>') + '<br>A última parcela absorve o arredondamento — o app cria essas parcelas sozinho ao confirmar.</div>';
  },

  openNovaConta() {
    document.getElementById('modalNovaContaBody').innerHTML = `
      <div class="modal-head"><h3>Nova conta</h3><button class="close-x" onclick="Modals.close('novaConta')">✕</button></div>
      <div class="field"><label>Nome da conta</label><input id="ncNome" placeholder="Ex: Nubank, Itaú, BB"></div>
      <div class="field"><label>Tipo</label><select id="ncTipo"><option>Conta Bancária</option><option>Digital</option><option>Físico</option><option>Investimento</option></select></div>
      <div class="field"><label>Saldo atual (R$)</label><input id="ncSaldo" type="number" step="0.01" placeholder="0,00"></div>
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Actions.salvarConta()">Adicionar conta</button>`;
    Modals.open('novaConta');
  },
  openNovoCartao() {
    document.getElementById('modalNovoCartaoBody').innerHTML = `
      <div class="modal-head"><h3>Novo cartão</h3><button class="close-x" onclick="Modals.close('novoCartao')">✕</button></div>
      <div class="field"><label>Nome do cartão</label><input id="ncartNome" placeholder="Ex: Cartão Nubank"></div>
      <div class="field-row">
        <div class="field"><label>Dia de fechamento</label><input id="ncartFechamento" type="number" min="1" max="28" value="24"></div>
        <div class="field"><label>Dia de vencimento</label><input id="ncartVencimento" type="number" min="1" max="28" value="5"></div>
      </div>
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Actions.salvarCartao()">Adicionar cartão</button>`;
    Modals.open('novoCartao');
  },
  openNovaMeta() {
    document.getElementById('modalNovaMetaBody').innerHTML = `
      <div class="modal-head"><h3>Nova meta</h3><button class="close-x" onclick="Modals.close('novaMeta')">✕</button></div>
      <div class="field"><label>Nome da meta</label><input id="nmNome" placeholder="Ex: Viagem em família"></div>
      <div class="field"><label>Ícone</label><select id="nmIcone"><option>✈️</option><option>🛡️</option><option>🚗</option><option>🏠</option><option>💻</option><option>🎓</option></select></div>
      <div class="field-row">
        <div class="field"><label>Valor alvo (R$)</label><input id="nmAlvo" type="number" step="0.01"></div>
        <div class="field"><label>Valor já guardado (R$)</label><input id="nmAtual" type="number" step="0.01" value="0"></div>
      </div>
      <div class="field"><label>Prazo estimado</label><input id="nmPrazo" placeholder="Ex: dez/2026"></div>
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Actions.salvarMeta()">Criar meta</button>`;
    Modals.open('novaMeta');
  },
  openNovoAtivo() {
    document.getElementById('modalNovoAtivoBody').innerHTML = `
      <div class="modal-head"><h3>Novo ativo</h3><button class="close-x" onclick="Modals.close('novoAtivo')">✕</button></div>
      <div class="field"><label>Nome</label><input id="naNome" placeholder="Ex: CDB Banco X"></div>
      <div class="field"><label>Tipo</label><select id="naTipo"><option>Renda Fixa</option><option>CDB</option><option>Consórcio</option><option>Ações</option><option>Outro</option></select></div>
      <div class="field-row">
        <div class="field"><label>Valor aportado (R$)</label><input id="naAportado" type="number" step="0.01"></div>
        <div class="field"><label>Valor atual (R$)</label><input id="naAtual" type="number" step="0.01"></div>
      </div>
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Actions.salvarAtivo()">Adicionar</button>`;
    Modals.open('novoAtivo');
  },
  openNovaSubcategoria(categoriaId) {
    document.getElementById('modalNovaSubcategoriaBody').innerHTML = `
      <div class="modal-head"><h3>Nova subcategoria</h3><button class="close-x" onclick="Modals.close('novaSubcategoria')">✕</button></div>
      <div class="field"><label>Categoria</label><input value="${categoriaNome(categoriaId)}" disabled></div>
      <div class="field"><label>Nome da subcategoria</label><input id="nsNome" placeholder="Ex: Farmácia"></div>
      <input type="hidden" id="nsCategoriaId" value="${categoriaId}">
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Actions.salvarSubcategoria()">Criar</button>`;
    Modals.open('novaSubcategoria');
  },
  abrirSyncManual(file) {
    if (!file) return;
    Sync._arquivoManualPendente = file;
    document.getElementById('modalSyncManualBody').innerHTML = `
      <div class="modal-head"><h3>Carregar arquivo sincronizado</h3><button class="close-x" onclick="Modals.close('syncManual')">✕</button></div>
      <div class="stat-sub" style="margin-bottom:12px;">Arquivo selecionado: ${file.name}</div>
      <div class="field"><label>PIN usado para criar esse arquivo</label><input id="syncManualPin" type="password" inputmode="numeric" placeholder="Digite o PIN"></div>
      <div class="stat-sub" id="syncManualMsg" style="min-height:16px; color:var(--red);"></div>
      <button class="btn" style="width:100%; margin-top:10px;" onclick="Sync.confirmarCarregarManual()">Carregar esta versão</button>`;
    Modals.open('syncManual');
    document.getElementById('fileSyncManual').value = '';
  },

  openEditarTransacao(id) {
    const l = STATE.lancamentos.find(x => x.id === id);
    if (!l) return;
    const descEsc = String(l.descricao).replace(/"/g, '&quot;');
    const catOpts = STATE.categorias.map(c => `<option value="${c.id}" ${c.id === l.categoriaId ? 'selected' : ''}>${CATEGORIA_ICONS[c.id] || ''} ${c.nome}</option>`).join('');
    const isCartaoAtual = l.formaPagamento === 'Cartão de Crédito';
    const contaOpts = STATE.cartoes.map(c => `<option value="cartao_${c.id}" ${isCartaoAtual && c.id === l.carteiraId ? 'selected' : ''}>${c.nome}</option>`)
      .concat(STATE.contas.map(c => `<option value="conta_${c.id}" ${!isCartaoAtual && c.id === l.carteiraId ? 'selected' : ''}>${c.nome}</option>`)).join('');
    const cartaoFaturaAtual = l.categoriaId === AppLogic.CATEGORIA_PAGAMENTO_FATURA ? resolverCartaoDaFatura(l) : null;
    const cartaoFaturaOpts = STATE.cartoes.map(c => `<option value="${c.id}" ${cartaoFaturaAtual && c.id === cartaoFaturaAtual.id ? 'selected' : ''}>${c.nome}</option>`).join('');
    document.getElementById('modalEditarTransacaoBody').innerHTML = `
      <div class="modal-head"><h3>Editar transação</h3><button class="close-x" onclick="Modals.close('editarTransacao')">✕</button></div>
      <div class="tabs">
        <div class="tab" id="etTabDespesa" style="flex:1; text-align:center;" onclick="Modals.setTipoEdicao('Despesa')">Despesa</div>
        <div class="tab" id="etTabReceita" style="flex:1; text-align:center;" onclick="Modals.setTipoEdicao('Receita')">Receita</div>
      </div>
      <input type="hidden" id="etTipo" value="${l.tipo}">
      <input type="hidden" id="etId" value="${l.id}">
      ${l.qtdParcelas > 1 ? `<div class="banner warn"><span>⚠️</span><div>Esta compra foi parcelada em ${l.qtdParcelas}x. Você está editando a compra inteira (valor total abaixo) — ao salvar, todas as ${l.qtdParcelas} parcelas são recalculadas.</div></div>` : ''}
      <div class="field"><label>Descrição</label><input id="etDescricao" value="${descEsc}"></div>
      <div class="field-row">
        <div class="field"><label>Valor (R$)</label><input id="etValor" type="number" step="0.01" value="${l.valor}"></div>
        <div class="field"><label>Data</label><input id="etData" type="date" value="${l.data}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label>Categoria</label><select id="etCategoria" onchange="Modals.refreshSubcategoriasEdicao(); Modals.refreshCampoCartaoFatura('et')">${catOpts}</select></div>
        <div class="field"><label>Subcategoria</label><select id="etSubcategoria"></select></div>
      </div>
      <div class="field"><label>Conta ou cartão</label><select id="etConta" onchange="Modals.refreshParcelasEdicao()">${contaOpts}</select></div>
      <div class="field" id="etCampoCartaoFatura" style="display:none;"><label>Qual cartão esta fatura está pagando?</label><select id="etCartaoFatura">${cartaoFaturaOpts}</select></div>
      <div class="field" id="etCampoParcelas" style="display:none;"><label>Número de parcelas</label>
        <select id="etParcelas" onchange="Modals.calcParcelasPreviewEdicao()">
          ${parcelaOptionsHtml()}
        </select></div>
      <div id="etParcelasPreview" class="logic-note" style="margin-top:0; display:none;"></div>
      <div style="display:flex; gap:10px; margin-top:10px;">
        <button class="btn" style="flex:1;" onclick="Actions.salvarEdicaoTransacao()">Salvar alterações</button>
        <button class="btn danger" onclick="Actions.excluirTransacao('${l.id}')">Excluir</button>
      </div>`;
    Modals.setTipoEdicao(l.tipo);
    Modals.refreshSubcategoriasEdicao();
    document.getElementById('etSubcategoria').value = l.subcategoriaId;
    document.getElementById('etParcelas').value = String(l.qtdParcelas || 1);
    Modals.refreshParcelasEdicao();
    Modals.refreshCampoCartaoFatura('et');
    Modals.open('editarTransacao');
  },
  setTipoEdicao(tipo) {
    document.getElementById('etTipo').value = tipo;
    document.getElementById('etTabDespesa').style.background = tipo === 'Despesa' ? '#3d1414' : '';
    document.getElementById('etTabDespesa').style.color = tipo === 'Despesa' ? '#f87171' : '';
    document.getElementById('etTabReceita').style.background = tipo === 'Receita' ? '#0e2f1c' : '';
    document.getElementById('etTabReceita').style.color = tipo === 'Receita' ? '#4ade80' : '';
  },
  refreshSubcategoriasEdicao() {
    const catId = Number(document.getElementById('etCategoria').value);
    const subs = STATE.subcategorias.filter(s => s.categoriaId === catId);
    document.getElementById('etSubcategoria').innerHTML = subs.map(s => `<option value="${s.id}">${s.nome}</option>`).join('');
  },
  refreshParcelasEdicao() {
    const val = document.getElementById('etConta').value;
    const isCartao = val.startsWith('cartao_');
    document.getElementById('etCampoParcelas').style.display = isCartao ? 'block' : 'none';
    document.getElementById('etParcelasPreview').style.display = isCartao ? 'block' : 'none';
    if (isCartao) Modals.calcParcelasPreviewEdicao();
  },
  calcParcelasPreviewEdicao() {
    const n = parseInt(document.getElementById('etParcelas').value, 10);
    const valor = parseFloat(document.getElementById('etValor').value) || 0;
    const box = document.getElementById('etParcelasPreview');
    if (!valor) { box.innerHTML = '<span>ℹ️</span><div>Informe o valor para ver a prévia das parcelas.</div>'; return; }
    const data = document.getElementById('etData').value;
    const contaId = document.getElementById('etConta').value.replace('cartao_', '');
    const cartao = STATE.cartoes.find(c => String(c.id) === contaId);
    if (!cartao) { box.innerHTML = ''; return; }
    const parcelas = AppLogic.gerarParcelas(valor, n, data, cartao.diaFechamento, cartao.diaVencimento);
    if (n === 1) { box.innerHTML = '<span>ℹ️</span><div>Compra à vista — valor total debitado na fatura de ' + MESES_NOMES[parcelas[0].mes] + '/' + parcelas[0].ano + '.</div>'; return; }
    box.innerHTML = '<span>ℹ️</span><div><b>Prévia automática:</b><br>' + parcelas.map(p => `Parcela ${p.numero}/${p.qtd}: ${fmtMoeda(p.valor)} — ${MESES_NOMES[p.mes]}/${p.ano}`).join('<br>') + '<br>A última parcela absorve o arredondamento — o app recalcula essas parcelas sozinho ao salvar.</div>';
  },
};

// ---------------- Actions (CRUD) ----------------
const Actions = {
  async salvarTransacao() {
    const tipo = document.getElementById('ntTipo').value;
    const descricao = document.getElementById('ntDescricao').value.trim();
    const valor = parseFloat(document.getElementById('ntValor').value);
    const data = document.getElementById('ntData').value;
    const categoriaId = Number(document.getElementById('ntCategoria').value);
    const subcategoriaId = Number(document.getElementById('ntSubcategoria').value);
    const contaVal = document.getElementById('ntConta').value;
    if (!descricao || !valor || !data || !contaVal) { alert('Preencha descrição, valor, data e conta/cartão.'); return; }
    const isCartao = contaVal.startsWith('cartao_');
    const carteiraId = Number(contaVal.replace('cartao_', '').replace('conta_', ''));
    const qtdParcelas = isCartao ? parseInt(document.getElementById('ntParcelas').value, 10) : 1;
    const isPagamentoFatura = categoriaId === AppLogic.CATEGORIA_PAGAMENTO_FATURA;
    const cartaoFaturaId = isPagamentoFatura ? Number(document.getElementById('ntCartaoFatura').value) || null : null;

    const lanc = {
      id: uuid(), data, tipo, categoriaId, subcategoriaId, descricao, valor,
      formaPagamento: isCartao ? 'Cartão de Crédito' : 'Outro', carteiraId,
      qtdParcelas, parcelaAtual: 1, cartaoFaturaId,
    };
    STATE.lancamentos.push(lanc);

    if (isCartao) {
      const cartao = STATE.cartoes.find(c => c.id === carteiraId);
      const geradas = AppLogic.gerarParcelas(valor, qtdParcelas, data, cartao.diaFechamento, cartao.diaVencimento);
      geradas.forEach(g => STATE.parcelas.push({
        id: uuid(), lancamentoId: lanc.id, carteiraId, categoriaId, subcategoriaId,
        valor: g.valor, numero: g.numero, qtd: g.qtd, ano: g.ano, mes: g.mes,
      }));
    }
    await persist();
    Modals.close('novaTransacao');
    Nav.show(Nav.atual);
  },

  async salvarEdicaoTransacao() {
    const id = document.getElementById('etId').value;
    const l = STATE.lancamentos.find(x => x.id === id);
    if (!l) return;
    const tipo = document.getElementById('etTipo').value;
    const descricao = document.getElementById('etDescricao').value.trim();
    const valor = parseFloat(document.getElementById('etValor').value);
    const data = document.getElementById('etData').value;
    const categoriaId = Number(document.getElementById('etCategoria').value);
    const subcategoriaId = Number(document.getElementById('etSubcategoria').value);
    const contaVal = document.getElementById('etConta').value;
    if (!descricao || !valor || !data || !contaVal) { alert('Preencha descrição, valor, data e conta/cartão.'); return; }
    const isCartao = contaVal.startsWith('cartao_');
    const carteiraId = Number(contaVal.replace('cartao_', '').replace('conta_', ''));
    const qtdParcelas = isCartao ? parseInt(document.getElementById('etParcelas').value, 10) : 1;
    const isPagamentoFatura = categoriaId === AppLogic.CATEGORIA_PAGAMENTO_FATURA;
    const cartaoFaturaId = isPagamentoFatura ? Number(document.getElementById('etCartaoFatura').value) || null : null;

    // Remove as parcelas antigas deste lançamento — se for cartão, são recriadas do zero abaixo.
    STATE.parcelas = STATE.parcelas.filter(p => p.lancamentoId !== id);

    Object.assign(l, {
      tipo, data, categoriaId, subcategoriaId, descricao, valor,
      formaPagamento: isCartao ? 'Cartão de Crédito' : 'Outro', carteiraId,
      qtdParcelas, parcelaAtual: 1, cartaoFaturaId,
    });

    if (isCartao) {
      const cartao = STATE.cartoes.find(c => c.id === carteiraId);
      const geradas = AppLogic.gerarParcelas(valor, qtdParcelas, data, cartao.diaFechamento, cartao.diaVencimento);
      geradas.forEach(g => STATE.parcelas.push({
        id: uuid(), lancamentoId: l.id, carteiraId, categoriaId, subcategoriaId,
        valor: g.valor, numero: g.numero, qtd: g.qtd, ano: g.ano, mes: g.mes,
      }));
    }
    await persist();
    Modals.close('editarTransacao');
    Nav.show(Nav.atual);
  },
  async excluirTransacao(id) {
    const l = STATE.lancamentos.find(x => x.id === id);
    if (!l) return;
    if (!confirm(`Excluir a transação "${l.descricao}" (${fmtMoeda(l.valor)}, ${fmtData(l.data)})?\n\nEsta ação não pode ser desfeita.`)) return;
    STATE.lancamentos = STATE.lancamentos.filter(x => x.id !== id);
    STATE.parcelas = STATE.parcelas.filter(p => p.lancamentoId !== id);
    await persist();
    Modals.close('editarTransacao');
    Nav.show(Nav.atual);
  },

  proximoIdCarteira() {
    return 1 + Math.max(0, ...STATE.contas.map(c => c.id), ...STATE.cartoes.map(c => c.id));
  },
  async salvarConta() {
    const nome = document.getElementById('ncNome').value.trim();
    if (!nome) return;
    STATE.contas.push({ id: Actions.proximoIdCarteira(), nome, tipo: document.getElementById('ncTipo').value, ativa: true, ehCartao: false, saldoInicial: parseFloat(document.getElementById('ncSaldo').value) || 0 });
    await persist(); Modals.close('novaConta'); Nav.show('contas');
  },
  async salvarCartao() {
    const nome = document.getElementById('ncartNome').value.trim();
    if (!nome) return;
    STATE.cartoes.push({ id: Actions.proximoIdCarteira(), nome, ehCartao: true, ativa: true,
      diaFechamento: parseInt(document.getElementById('ncartFechamento').value, 10),
      diaVencimento: parseInt(document.getElementById('ncartVencimento').value, 10) });
    await persist(); Modals.close('novoCartao'); Nav.show('cartoes');
  },
  async salvarMeta() {
    const nome = document.getElementById('nmNome').value.trim();
    if (!nome) return;
    STATE.metas.push({ id: uuid(), nome, icone: document.getElementById('nmIcone').value,
      valorAlvo: parseFloat(document.getElementById('nmAlvo').value) || 0,
      valorAtual: parseFloat(document.getElementById('nmAtual').value) || 0,
      prazo: document.getElementById('nmPrazo').value });
    await persist(); Modals.close('novaMeta'); Nav.show('metas');
  },
  async salvarAtivo() {
    const nome = document.getElementById('naNome').value.trim();
    if (!nome) return;
    STATE.investimentos.push({ id: uuid(), nome, tipo: document.getElementById('naTipo').value,
      valorAportado: parseFloat(document.getElementById('naAportado').value) || 0,
      valorAtual: parseFloat(document.getElementById('naAtual').value) || 0 });
    await persist(); Modals.close('novoAtivo'); Nav.show('investimentos');
  },
  async salvarSubcategoria() {
    const nome = document.getElementById('nsNome').value.trim();
    const categoriaId = Number(document.getElementById('nsCategoriaId').value);
    if (!nome) return;
    const maxId = Math.max(0, ...STATE.subcategorias.map(s => s.id));
    STATE.subcategorias.push({ id: maxId + 1, categoriaId, nome, ativa: true });
    await persist(); Modals.close('novaSubcategoria'); Nav.show('categorias');
  },

  mudarMes(delta) {
    let { ano, mes } = VIEW;
    mes += delta;
    if (mes > 12) { mes = 1; ano++; }
    if (mes < 1) { mes = 12; ano--; }
    VIEW = { ano, mes };
    Nav.show(Nav.atual);
  },
  irParaHoje() {
    const hoje = new Date();
    VIEW = { ano: hoje.getFullYear(), mes: hoje.getMonth() + 1 };
    Nav.show(Nav.atual);
  },
  async toggleChatIA() { STATE.config.chatIA = !STATE.config.chatIA; await persist(); Nav.show('chatia'); },
  async toggleModoAgregado() { STATE.config.modoAgregado = !STATE.config.modoAgregado; await persist(); Nav.show('chatia'); },
  async setBloqueio(min) { STATE.config.bloqueioMin = Number(min); await persist(); Auth.resetInactivity(); },

  exportarCSV(escopo) {
    const { ano, mes } = VIEW;
    let lista;
    let nomeArquivo;
    if (escopo === 'mes') {
      lista = itensDoMes(ano, mes);
      nomeArquivo = 'transacoes-' + String(mes).padStart(2, '0') + '-' + ano + '.csv';
    } else {
      lista = itensTodoPeriodo();
      nomeArquivo = 'transacoes-todo-periodo.csv';
    }
    lista = lista.slice().sort((a, b) => a.data.localeCompare(b.data));
    const cab = ['Data', 'Tipo', 'Categoria', 'Subcategoria', 'Descricao', 'Valor', 'FormaPagamento', 'ContaOuCartao', 'Parcela'];
    function csvEscape(v) {
      const s = String(v == null ? '' : v);
      return /[;"\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }
    const linhas = lista.map(l => [
      l.data, l.tipo, categoriaNome(l.categoriaId), subcategoriaNome(l.subcategoriaId),
      l.descricao, l.valor.toFixed(2).replace('.', ','), l.formaPagamento, contaOuCartaoNome(l.carteiraId),
      l.isParcela && l.qtd > 1 ? (l.numero + '/' + l.qtd) : '',
    ].map(csvEscape).join(';'));
    const csv = '﻿' + cab.join(';') + '\r\n' + linhas.join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nomeArquivo;
    a.click();
  },

  async exportBackup() {
    const texto = await AppStorage.exportBackup();
    const blob = new Blob([texto], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'backup-orcamento-familiar-' + new Date().toISOString().slice(0,10) + '.json';
    a.click();
  },
  async importBackup(file) {
    if (!file) return;
    const texto = await file.text();
    try {
      await AppStorage.importBackup(texto);
      alert('Backup restaurado. Faça login novamente com o PIN daquele backup.');
      location.reload();
    } catch (e) {
      alert('Não foi possível restaurar: ' + e.message);
    }
  },

  async baixarSync() {
    const raw = await AppStorage.getRaw();
    if (!raw) { alert('Nada para sincronizar ainda.'); return; }
    const blob = new Blob([JSON.stringify(raw)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dados-sincronizados.kfsync';
    a.click();
  },
  async zerarDados() {
    if (!confirm('Isso apaga TODOS os dados permanentemente. Tem certeza?')) return;
    if (!confirm('Confirme novamente: apagar tudo e começar do zero?')) return;
    localStorage.clear();
    if (typeof indexedDB !== 'undefined') indexedDB.deleteDatabase('orcamento_familiar_db');
    location.reload();
  },
};

// ---------------- Sincronização (camada de interface) ----------------
const Sync = {
  async checkNewerOnLogin(pinUsado) {
    const banner = document.getElementById('syncBanner');
    if (!banner) return;
    banner.innerHTML = '';
    if (!AppSync.supported()) return;
    try {
      if (!(await AppSync.isEnabled())) return;
      const synced = await AppSync.read();
      const local = await AppStorage.getRaw();
      if (!synced || !synced.atualizadoEm) return;
      if (local && local.atualizadoEm && synced.atualizadoEm <= local.atualizadoEm) return;
      const quando = new Date(synced.atualizadoEm).toLocaleString('pt-BR');
      banner.innerHTML = `
        <div class="banner info" style="margin:0 0 16px;">
          <span>ℹ️</span>
          <div style="flex:1;">
            <b>Encontramos uma versão sincronizada mais recente</b> (salva em ${quando}, provavelmente de outro aparelho).
            Nada foi alterado ainda — escolha o que fazer:
            <div style="display:flex; gap:10px; margin-top:10px;">
              <button class="btn sm" onclick="Sync.usarVersaoSincronizada('${pinUsado}')">Usar versão sincronizada</button>
              <button class="btn ghost sm" onclick="document.getElementById('syncBanner').innerHTML=''">Manter esta versão</button>
            </div>
          </div>
        </div>`;
    } catch (e) { /* falha silenciosa — não interrompe o uso normal do app */ }
  },

  async usarVersaoSincronizada(pinUsado) {
    try {
      const synced = await AppSync.read();
      STATE = await AppStorage.unlockVaultFromRaw(pinUsado, synced);
      await AppStorage.adoptRaw(synced);
      document.getElementById('syncBanner').innerHTML = '';
      Nav.show('dashboard');
    } catch (e) {
      alert('Não foi possível carregar a versão sincronizada: ' + e.message);
    }
  },

  async ativar() {
    if (!AppSync.supported()) { alert('Seu navegador não suporta esse recurso. Use Google Chrome ou Microsoft Edge.'); return; }
    try {
      await AppSync.pickNewFile();
      const raw = await AppStorage.getRaw();
      await AppSync.write(raw);
      Nav.show('config');
    } catch (e) { /* usuário cancelou a escolha do arquivo */ }
  },
  async vincularExistente() {
    if (!AppSync.supported()) { alert('Seu navegador não suporta esse recurso. Use Google Chrome ou Microsoft Edge.'); return; }
    try {
      await AppSync.pickExistingFile();
      Nav.show('config');
    } catch (e) { /* usuário cancelou */ }
  },
  async desativar() {
    await AppSync.disable();
    Nav.show('config');
  },

  _arquivoManualPendente: null,
async confirmarCarregarManual() {
    const pin = document.getElementById('syncManualPin').value;
    const msg = document.getElementById('syncManualMsg');
    const file = this._arquivoManualPendente;
    if (!file || !pin) { if (msg) msg.textContent = 'Digite o PIN.'; return; }
    try {
      const texto = await file.text();
      const raw = JSON.parse(texto);
      if (!raw || !raw.salt || !raw.payload) throw new Error('Arquivo inválido.');
      STATE = await AppStorage.unlockVaultFromRaw(pin, raw);
      await AppStorage.adoptRaw(raw);
      this._arquivoManualPendente = null;
      Modals.close('syncManual');
      Nav.show('dashboard');
    } catch (e) {
      if (msg) msg.textContent = 'Não foi possível carregar: PIN incorreto ou arquivo inválido.';
    }
  },
};
