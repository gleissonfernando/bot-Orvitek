// ============================================================
// seu HTML e importe este arquivo com <script src="painel_vendas.js"></script>
// ============================================================

(function () {

  // ── CONFIGURAÇÕES (edite aqui) ──────────────────────────────
  const CONFIG = {
    planos: [
      { id: 'basico',  nome: 'Plano Básico',   preco: 49.90, desconto_cupom: 0.30, popular: false },
      { id: 'premium', nome: 'Plano Premium',  preco: 99.90, desconto_cupom: 0.50, popular: true  },
    ],
    formas_pagamento: [
      { id: 'avista',  label: '100% agora',       titulo: 'À Vista',     icone: 'ti-cash'        },
      { id: 'parcial', label: 'Entrada + restante', titulo: '50% + 50%',   icone: 'ti-credit-card' },
    ],
    cupons_validos: ['PROMO2024', 'DESCONTO', 'BLACK50', 'SALE'],
    aviso: 'Este formulário será enviado ao sistema de vendas. Não compartilhe sua senha ou dados confidenciais.',
  };

  // ── ESTADO ─────────────────────────────────────────────────
  let state = {
    plano: null,
    pagamento: null,
    cupom_ativo: false,
    cupom_valido: false,
    cupom_texto: '',
  };

  // ── ESTILOS ─────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('pv-styles')) return;
    const style = document.createElement('style');
    style.id = 'pv-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');
      @import url('https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@latest/tabler-icons.min.css');

      #pv-overlay {
        position: fixed; inset: 0;
        background: rgba(0,0,0,0.65);
        display: flex; align-items: center; justify-content: center;
        z-index: 99999;
        animation: pv-fade .2s ease;
        font-family: 'DM Sans', sans-serif;
      }
      @keyframes pv-fade { from { opacity:0 } to { opacity:1 } }
      @keyframes pv-up   { from { opacity:0; transform:translateY(18px) scale(.97) } to { opacity:1; transform:none } }

      #pv-modal {
        background: #1a1b2e;
        border-radius: 14px;
        width: 380px; max-width: 95vw;
        border: 1px solid rgba(255,255,255,0.07);
        overflow: hidden;
        animation: pv-up .25s cubic-bezier(.34,1.56,.64,1);
        box-shadow: 0 32px 80px rgba(0,0,0,.6), 0 0 0 1px rgba(124,107,255,.1);
        color: #f0f0ff;
      }

      /* header */
      #pv-modal .pv-header {
        background: #13142a;
        padding: 13px 18px;
        display: flex; align-items: center; justify-content: space-between;
        border-bottom: 1px solid rgba(255,255,255,.08);
      }
      #pv-modal .pv-header-left { display:flex; align-items:center; gap:9px; }
      #pv-modal .pv-hicon {
        width:30px; height:30px; border-radius:7px;
        background:#7c6bff;
        display:flex; align-items:center; justify-content:center;
        font-size:15px; color:#fff;
      }
      #pv-modal .pv-htitle { font-size:14px; font-weight:600; color:#f0f0ff; }
      #pv-modal .pv-close {
        font-size:18px; color:rgba(255,255,255,.35);
        cursor:pointer; line-height:1; background:none; border:none;
        transition: color .15s;
      }
      #pv-modal .pv-close:hover { color:#f0f0ff; }

      /* aviso */
      #pv-modal .pv-warning {
        background: rgba(250,200,80,.1);
        border-bottom: 1px solid rgba(250,200,80,.2);
        padding: 10px 16px;
        display: flex; gap:8px; align-items:flex-start;
        font-size:11.5px; line-height:1.5; color:#f5d06a;
      }
      #pv-modal .pv-warning i { margin-top:1px; flex-shrink:0; }

      /* body */
      #pv-modal .pv-body { padding:18px; display:flex; flex-direction:column; gap:16px; }

      /* label */
      #pv-modal .pv-label {
        font-size:12px; color:rgba(240,240,255,.6);
        display:block; margin-bottom:7px;
      }
      #pv-modal .pv-required { color:#f87171; }

      /* plano cards */
      #pv-modal .pv-plan-card {
        border: 1px solid rgba(255,255,255,.09);
        border-radius: 9px;
        padding: 11px 13px;
        cursor: pointer;
        display: flex; justify-content:space-between; align-items:center;
        margin-bottom: 6px;
        transition: border-color .15s, background .15s;
        background: transparent;
      }
      #pv-modal .pv-plan-card:last-child { margin-bottom:0; }
      #pv-modal .pv-plan-card:hover { border-color: rgba(124,107,255,.4); }
      #pv-modal .pv-plan-card.selected {
        border-color: #7c6bff;
        background: rgba(124,107,255,.1);
      }
      #pv-modal .pv-plan-name {
        font-size:13px; font-weight:500; color:#f0f0ff;
        display:flex; align-items:center; gap:7px;
      }
      #pv-modal .pv-popular {
        font-size:10px; background:#7c6bff; color:#fff;
        padding:2px 8px; border-radius:4px; font-weight:500;
      }
      #pv-modal .pv-plan-sub {
        font-size:11px; color:rgba(240,240,255,.4); margin-top:3px;
      }
      #pv-modal .pv-radio {
        width:16px; height:16px; border-radius:50%;
        border:2px solid rgba(255,255,255,.2);
        flex-shrink:0; transition: all .15s;
        display:flex; align-items:center; justify-content:center;
      }
      #pv-modal .pv-plan-card.selected .pv-radio {
        background:#7c6bff; border-color:#7c6bff;
      }
      #pv-modal .pv-radio-dot {
        width:6px; height:6px; border-radius:50%;
        background:#fff; display:none;
      }
      #pv-modal .pv-plan-card.selected .pv-radio-dot { display:block; }

      /* pagamento */
      #pv-modal .pv-pay-grid { display:flex; gap:8px; }
      #pv-modal .pv-pay-card {
        flex:1; border:1px solid rgba(255,255,255,.09);
        border-radius:9px; padding:10px 8px;
        cursor:pointer; text-align:center;
        transition: border-color .15s, background .15s;
        background:transparent;
      }
      #pv-modal .pv-pay-card:hover { border-color:rgba(124,107,255,.4); }
      #pv-modal .pv-pay-card.selected {
        border-color:#7c6bff; background:rgba(124,107,255,.1);
      }
      #pv-modal .pv-pay-icon {
        font-size:20px; color:rgba(255,255,255,.4);
        display:block; margin-bottom:4px; transition:color .15s;
      }
      #pv-modal .pv-pay-card.selected .pv-pay-icon { color:#7c6bff; }
      #pv-modal .pv-pay-title { font-size:12px; font-weight:500; color:#f0f0ff; }
      #pv-modal .pv-pay-sub { font-size:10px; color:rgba(240,240,255,.35); margin-top:2px; }

      /* checkbox cupom */
      #pv-modal .pv-check-row {
        display:flex; align-items:center; gap:9px;
        cursor:pointer; user-select:none;
      }
      #pv-modal .pv-checkbox {
        width:16px; height:16px; border-radius:4px;
        border:2px solid rgba(255,255,255,.22);
        flex-shrink:0; display:flex; align-items:center; justify-content:center;
        transition: all .15s; background:transparent;
      }
      #pv-modal .pv-checkbox.checked {
        background:#7c6bff; border-color:#7c6bff;
      }
      #pv-modal .pv-checkbox i { font-size:11px; color:#fff; display:none; }
      #pv-modal .pv-checkbox.checked i { display:block; }
      #pv-modal .pv-check-label { font-size:12.5px; color:rgba(240,240,255,.7); }

      /* input cupom */
      #pv-modal .pv-coupon-wrap { margin-top:10px; display:none; }
      #pv-modal .pv-coupon-wrap.visible { display:block; }
      #pv-modal .pv-input-wrap { position:relative; }
      #pv-modal .pv-input {
        width:100%; background:#0f1024;
        border:1px solid rgba(255,255,255,.1);
        border-radius:8px; padding:9px 38px 9px 12px;
        color:#f0f0ff; font-size:13px; font-family:inherit;
        outline:none; transition:border-color .15s;
        letter-spacing:.5px;
      }
      #pv-modal .pv-input:focus { border-color:rgba(124,107,255,.5); }
      #pv-modal .pv-input::placeholder { color:rgba(240,240,255,.25); letter-spacing:0; }
      #pv-modal .pv-input-icon {
        position:absolute; right:11px; top:50%; transform:translateY(-50%);
        font-size:16px; color:rgba(255,255,255,.25); pointer-events:none;
        transition:color .15s;
      }
      #pv-modal .pv-coupon-msg {
        font-size:11px; margin-top:6px; display:none;
      }
      #pv-modal .pv-coupon-msg.show { display:block; }
      #pv-modal .pv-coupon-msg.ok  { color:#4ade80; }
      #pv-modal .pv-coupon-msg.err { color:#f87171; }

      /* resumo */
      #pv-modal .pv-summary {
        background:#13142a; border-radius:9px;
        padding:13px 14px; border:1px solid rgba(255,255,255,.07);
        display:none;
      }
      #pv-modal .pv-summary.visible { display:block; }
      #pv-modal .pv-sum-row {
        display:flex; justify-content:space-between; align-items:center;
        margin-bottom:6px; font-size:12px;
      }
      #pv-modal .pv-sum-row:last-child { margin-bottom:0; }
      #pv-modal .pv-sum-label { color:rgba(240,240,255,.45); }
      #pv-modal .pv-sum-val   { color:#f0f0ff; }
      #pv-modal .pv-sum-discount .pv-sum-label,
      #pv-modal .pv-sum-discount .pv-sum-val { color:#4ade80; }
      #pv-modal .pv-divider {
        border:none; border-top:1px solid rgba(255,255,255,.07);
        margin:8px 0;
      }
      #pv-modal .pv-total-row {
        display:flex; justify-content:space-between; align-items:center;
      }
      #pv-modal .pv-total-label { font-size:13px; font-weight:500; color:#f0f0ff; }
      #pv-modal .pv-total-val   { font-size:17px; font-weight:600; color:#7c6bff; }

      /* footer */
      #pv-modal .pv-footer {
        padding:0 18px 18px;
        display:flex; gap:8px;
      }
      #pv-modal .pv-btn-cancel {
        flex:1; background:transparent;
        border:1px solid rgba(255,255,255,.1);
        border-radius:8px; padding:10px;
        color:rgba(240,240,255,.55); font-size:13px;
        font-family:inherit; cursor:pointer;
        transition: border-color .15s, color .15s;
      }
      #pv-modal .pv-btn-cancel:hover {
        border-color:rgba(255,255,255,.25); color:#f0f0ff;
      }
      #pv-modal .pv-btn-confirm {
        flex:2; background:#7c6bff; border:none;
        border-radius:8px; padding:10px;
        color:#fff; font-size:13px; font-weight:600;
        font-family:inherit; cursor:pointer;
        transition: background .15s, transform .1s;
      }
      #pv-modal .pv-btn-confirm:hover  { background:#6a58f0; }
      #pv-modal .pv-btn-confirm:active { transform:scale(.98); }
    `;
    document.head.appendChild(style);
  }

  // ── RENDER ──────────────────────────────────────────────────
  function render() {
    let old = document.getElementById('pv-overlay');
    if (old) old.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pv-overlay';

    overlay.innerHTML = `
      <div id="pv-modal" role="dialog" aria-modal="true" aria-label="Novo Pedido">

        <div class="pv-header">
          <div class="pv-header-left">
            <div class="pv-hicon"><i class="ti ti-shopping-cart"></i></div>
            <span class="pv-htitle">Novo Pedido</span>
          </div>
          <button class="pv-close" id="pv-btn-close" aria-label="Fechar">&times;</button>
        </div>

        <div class="pv-warning">
          <i class="ti ti-alert-triangle"></i>
          <span>${CONFIG.aviso}</span>
        </div>

        <div class="pv-body">

          <!-- PLANOS -->
          <div>
            <label class="pv-label">Selecione o Plano <span class="pv-required">*</span></label>
            ${CONFIG.planos.map(p => `
              <div class="pv-plan-card${state.plano === p.id ? ' selected' : ''}"
                   data-plan="${p.id}" onclick="PainelVendas.selectPlano('${p.id}')">
                <div>
                  <div class="pv-plan-name">
                    ${p.nome}
                    ${p.popular ? '<span class="pv-popular">Popular</span>' : ''}
                  </div>
                  <div class="pv-plan-sub">
                    R$ ${p.preco.toFixed(2).replace('.', ',')}/mês
                    &nbsp;·&nbsp; Cupom: ${Math.round(p.desconto_cupom * 100)}% off
                  </div>
                </div>
                <div class="pv-radio"><div class="pv-radio-dot"></div></div>
              </div>
            `).join('')}
          </div>

          <!-- PAGAMENTO -->
          <div>
            <label class="pv-label">Forma de Pagamento <span class="pv-required">*</span></label>
            <div class="pv-pay-grid">
              ${CONFIG.formas_pagamento.map(f => `
                <div class="pv-pay-card${state.pagamento === f.id ? ' selected' : ''}"
                     data-pay="${f.id}" onclick="PainelVendas.selectPagamento('${f.id}')">
                  <i class="ti ${f.icone} pv-pay-icon"></i>
                  <div class="pv-pay-title">${f.titulo}</div>
                  <div class="pv-pay-sub">${f.label}</div>
                </div>
              `).join('')}
            </div>
          </div>

          <!-- CUPOM -->
          <div>
            <div class="pv-check-row" onclick="PainelVendas.toggleCupom()">
              <div class="pv-checkbox${state.cupom_ativo ? ' checked' : ''}" id="pv-chk">
                <i class="ti ti-check"></i>
              </div>
              <span class="pv-check-label">Tenho um cupom de desconto</span>
            </div>
            <div class="pv-coupon-wrap${state.cupom_ativo ? ' visible' : ''}" id="pv-coupon-wrap">
              <label class="pv-label" style="margin-top:10px;">Digite o cupom</label>
              <div class="pv-input-wrap">
                <input class="pv-input" id="pv-coupon-input"
                       type="text" placeholder="Ex: PROMO2024"
                       value="${state.cupom_texto}"
                       oninput="PainelVendas.validarCupom(this.value)"
                       autocomplete="off" spellcheck="false" />
                <i class="ti ${state.cupom_valido ? 'ti-check' : 'ti-tag'} pv-input-icon"
                   id="pv-coupon-icon"
                   style="color:${state.cupom_valido ? '#4ade80' : 'rgba(255,255,255,.25)'}"></i>
              </div>
              <div class="pv-coupon-msg${state.cupom_texto ? ' show' : ''} ${state.cupom_valido ? 'ok' : 'err'}"
                   id="pv-coupon-msg">
                ${state.cupom_texto
                  ? (state.cupom_valido
                    ? `✓ Cupom válido! ${state.plano ? Math.round(CONFIG.planos.find(p=>p.id===state.plano).desconto_cupom*100) : '?'}% de desconto aplicado.`
                    : '✕ Cupom inválido ou expirado.')
                  : ''}
              </div>
            </div>
          </div>

          <!-- RESUMO -->
          <div class="pv-summary${state.plano ? ' visible' : ''}" id="pv-summary">
            ${renderResumo()}
          </div>

        </div>

        <div class="pv-footer">
          <button class="pv-btn-cancel" id="pv-btn-cancel">Cancelar</button>
          <button class="pv-btn-confirm" onclick="PainelVendas.confirmar()">Confirmar Pedido</button>
        </div>

      </div>
    `;

    document.body.appendChild(overlay);

    document.getElementById('pv-btn-close').onclick  = PainelVendas.fechar;
    document.getElementById('pv-btn-cancel').onclick = PainelVendas.fechar;
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) PainelVendas.fechar();
    });
  }

  function renderResumo() {
    if (!state.plano) return '';
    const plano = CONFIG.planos.find(p => p.id === state.plano);
    const base  = plano.preco;
    let total   = base;
    let descontoVal = 0;

    if (state.cupom_valido) {
      descontoVal = base * plano.desconto_cupom;
      total = base - descontoVal;
    }

    const pagamento = state.pagamento
      ? CONFIG.formas_pagamento.find(f => f.id === state.pagamento)
      : null;

    return `
      <div class="pv-sum-row">
        <span class="pv-sum-label">Plano</span>
        <span class="pv-sum-val">${plano.nome}</span>
      </div>
      <div class="pv-sum-row">
        <span class="pv-sum-label">Valor original</span>
        <span class="pv-sum-val">R$ ${base.toFixed(2).replace('.', ',')}</span>
      </div>
      ${state.cupom_valido ? `
      <div class="pv-sum-row pv-sum-discount">
        <span class="pv-sum-label">Desconto (${Math.round(plano.desconto_cupom*100)}%)</span>
        <span class="pv-sum-val">- R$ ${descontoVal.toFixed(2).replace('.', ',')}</span>
      </div>` : ''}
      ${pagamento ? `
      <div class="pv-sum-row">
        <span class="pv-sum-label">Pagamento</span>
        <span class="pv-sum-val">${pagamento.titulo}${state.pagamento === 'parcial'
          ? ' (R$ ' + (total/2).toFixed(2).replace('.', ',') + ' agora)'
          : ''}</span>
      </div>` : ''}
      <hr class="pv-divider"/>
      <div class="pv-total-row">
        <span class="pv-total-label">Total</span>
        <span class="pv-total-val">R$ ${total.toFixed(2).replace('.', ',')}</span>
      </div>
    `;
  }

  function update() {
    const summary = document.getElementById('pv-summary');
    if (summary) {
      summary.innerHTML = renderResumo();
      summary.classList.toggle('visible', !!state.plano);
    }
  }

  // ── API PÚBLICA ──────────────────────────────────────────────
  window.PainelVendas = {

    abrir() {
      injectStyles();
      render();
    },

    fechar() {
      const el = document.getElementById('pv-overlay');
      if (el) el.remove();
    },

    selectPlano(id) {
      state.plano = id;
      document.querySelectorAll('.pv-plan-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.plan === id);
      });
      if (state.cupom_texto) {
        PainelVendas.validarCupom(state.cupom_texto);
      }
      update();
    },

    selectPagamento(id) {
      state.pagamento = id;
      document.querySelectorAll('.pv-pay-card').forEach(c => {
        c.classList.toggle('selected', c.dataset.pay === id);
      });
      update();
    },

    toggleCupom() {
      state.cupom_ativo = !state.cupom_ativo;
      const chk  = document.getElementById('pv-chk');
      const wrap = document.getElementById('pv-coupon-wrap');
      if (chk)  chk.classList.toggle('checked', state.cupom_ativo);
      if (wrap) wrap.classList.toggle('visible', state.cupom_ativo);
      if (!state.cupom_ativo) {
        state.cupom_valido = false;
        state.cupom_texto  = '';
        const inp = document.getElementById('pv-coupon-input');
        const msg = document.getElementById('pv-coupon-msg');
        const ico = document.getElementById('pv-coupon-icon');
        if (inp) inp.value = '';
        if (msg) { msg.textContent = ''; msg.className = 'pv-coupon-msg'; }
        if (ico) { ico.className = 'ti ti-tag pv-input-icon'; ico.style.color = 'rgba(255,255,255,.25)'; }
        update();
      }
    },

    validarCupom(valor) {
      state.cupom_texto = valor.toUpperCase();
      const valido = CONFIG.cupons_validos.includes(state.cupom_texto);
      state.cupom_valido = valido && valor.length > 0;

      const msg = document.getElementById('pv-coupon-msg');
      const ico = document.getElementById('pv-coupon-icon');

      if (!valor) {
        if (msg) { msg.textContent = ''; msg.className = 'pv-coupon-msg'; }
        if (ico) { ico.className = 'ti ti-tag pv-input-icon'; ico.style.color = 'rgba(255,255,255,.25)'; }
        state.cupom_valido = false;
      } else if (state.cupom_valido) {
        const plano = state.plano ? CONFIG.planos.find(p => p.id === state.plano) : null;
        const pct   = plano ? Math.round(plano.desconto_cupom * 100) : '?';
        if (msg) { msg.textContent = `✓ Cupom válido! ${pct}% de desconto aplicado.`; msg.className = 'pv-coupon-msg show ok'; }
        if (ico) { ico.className = 'ti ti-check pv-input-icon'; ico.style.color = '#4ade80'; }
      } else {
        if (msg) { msg.textContent = '✕ Cupom inválido ou expirado.'; msg.className = 'pv-coupon-msg show err'; }
        if (ico) { ico.className = 'ti ti-x pv-input-icon'; ico.style.color = '#f87171'; }
      }
      update();
    },

    confirmar() {
      if (!state.plano) {
        alert('⚠️ Selecione um plano antes de continuar!');
        return;
      }
      if (!state.pagamento) {
        alert('⚠️ Selecione a forma de pagamento!');
        return;
      }

      const plano    = CONFIG.planos.find(p => p.id === state.plano);
      const pagament = CONFIG.formas_pagamento.find(f => f.id === state.pagamento);
      const total    = state.cupom_valido
        ? plano.preco * (1 - plano.desconto_cupom)
        : plano.preco;

      alert(
        `✅ Pedido confirmado!\n\n` +
        `Plano: ${plano.nome}\n` +
        `Pagamento: ${pagament.titulo}\n` +
        (state.cupom_valido ? `Cupom: ${Math.round(plano.desconto_cupom*100)}% de desconto\n` : '') +
        `Total: R$ ${total.toFixed(2).replace('.', ',')}`
      );

      PainelVendas.fechar();
    },
  };

  // ── ABRE AUTOMATICAMENTE ─────────────────────────────────────
  // Remova ou comente a linha abaixo se quiser controlar
  // a abertura manualmente via PainelVendas.abrir()
  window.addEventListener('DOMContentLoaded', function () {
    PainelVendas.abrir();
  });

})();
