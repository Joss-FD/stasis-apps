/* Trade Calculator — blended card + cash trade maths. */
Hub.register('trade-calculator', {
  mount(el) {
    el.innerHTML = `
      <div class="card">
        <div class="header">
          <div class="title-wrap">
            <h1>Trade Calculator</h1>
            <div class="subtitle">
              Quick blended trade math for deals where part is paid in cards and part in cash. Clean, fast, and easy to read at the counter.
            </div>
          </div>
          <div class="badge">🃏 Trade mode</div>
        </div>

        <div class="grid">
          <div class="field">
            <label for="theirValue">Their card value</label>
            <div class="input-wrap">
              <span class="input-prefix">$</span>
              <input class="money-input" id="theirValue" type="number" min="0" step="1" inputmode="decimal" placeholder="Enter value" />
            </div>
            <div class="helper-chip">
              <div class="small-inline" id="tradeAdjustedText">Trade value: —</div>
            </div>
          </div>

          <div class="field">
            <label for="yourValue">Your card value (they want)</label>
            <div class="input-wrap">
              <span class="input-prefix">$</span>
              <input class="money-input" id="yourValue" type="number" min="0" step="1" inputmode="decimal" placeholder="Enter value" />
            </div>
          </div>

          <div class="field">
            <label for="tradePercent">Trade %</label>
            <input id="tradePercent" type="number" min="0.01" step="1" value="80" inputmode="decimal" required />
          </div>

          <div class="field">
            <label for="cashPercent">Cash %</label>
            <input id="cashPercent" type="number" min="0.01" step="1" value="70" inputmode="decimal" required />
          </div>
        </div>

        <div class="actions">
          <button class="primary" data-action="calculate">✨ Recalculate</button>
          <button class="secondary" data-action="reset">Reset</button>
        </div>

        <div class="big-result">
          <div class="big-label" id="cashLabel">You pay (cash)</div>
          <div class="big-value" id="cashValue">$0.00</div>
          <div class="big-sub" id="resultHint">Main cash result for this deal.</div>
        </div>

        <div class="info-grid">
          <div class="info-card">
            <div class="info-label">Effective rate</div>
            <div class="info-value" id="effectiveRate">0.00%</div>
          </div>
          <div class="info-card">
            <div class="info-label">Cost basis</div>
            <div class="info-value" id="costBasis">$0.00</div>
          </div>
          <div class="info-card">
            <div class="info-label">Remaining value</div>
            <div class="info-value" id="remainingValue">$0.00</div>
          </div>
        </div>

        <div class="footer-note">
          Uses your blended method: trade portion at trade %, cash portion at cash %. Auto-calculates when you tab or click out of a field.
        </div>
      </div>
    `;

    const $ = (id) => el.querySelector('#' + id);

    function fmtMoney(v) {
      return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(Number(v || 0));
    }
    function fmtPercent(v) {
      return Number(v || 0).toFixed(2) + '%';
    }
    function n(id) {
      return parseFloat($(id).value) || 0;
    }
    function rateColor(rate) {
      const root = getComputedStyle(document.documentElement);
      if (rate >= 75) return root.getPropertyValue('--good').trim();
      if (rate >= 72) return root.getPropertyValue('--mid').trim();
      return root.getPropertyValue('--bad').trim();
    }
    function setCashTone(isCustomerPays) {
      const box = el.querySelector('.big-result');
      if (isCustomerPays) {
        box.style.borderColor = 'rgba(34,197,94,.38)';
        box.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.03), 0 0 0 1px rgba(34,197,94,.10)';
      } else {
        box.style.borderColor = 'rgba(239,68,68,.30)';
        box.style.boxShadow = 'inset 0 1px 0 rgba(255,255,255,.03), 0 0 0 1px rgba(239,68,68,.08)';
      }
    }

    function showInvalid(label, hint) {
      $('tradeAdjustedText').textContent = 'Trade value: —';
      $('cashLabel').textContent = label;
      $('cashValue').textContent = '$0.00';
      $('costBasis').textContent = '$0.00';
      $('effectiveRate').textContent = '0.00%';
      $('effectiveRate').style.color = '';
      $('remainingValue').textContent = '$0.00';
      $('resultHint').textContent = hint;
    }

    function calculate() {
      const A = n('theirValue');
      const B = n('yourValue');
      const T = n('tradePercent') / 100;
      const C = n('cashPercent') / 100;

      if (!Number.isFinite(T) || T <= 0) {
        return showInvalid('Enter valid trade %', 'Trade % must be above 0 and cannot be empty.');
      }
      if (!Number.isFinite(C) || C <= 0) {
        return showInvalid('Enter valid cash %', 'Cash % must be above 0 and cannot be empty.');
      }

      const tradeVal = A * T;
      $('tradeAdjustedText').textContent = 'Trade value: ' + fmtMoney(tradeVal);

      if (tradeVal >= B) {
        const remaining = A - (B / T);
        const cash = remaining * C;
        const cost = B + cash;
        const rate = A ? (cost / A) * 100 : 0;

        $('cashLabel').textContent = 'You pay (cash) 💸';
        $('cashValue').textContent = fmtMoney(cash);
        $('costBasis').textContent = fmtMoney(cost);
        $('effectiveRate').textContent = fmtPercent(rate);
        $('effectiveRate').style.color = rateColor(rate);
        $('remainingValue').textContent = fmtMoney(remaining);
        $('resultHint').textContent = 'You are giving cards plus cash to complete the trade.';
        setCashTone(false);
      } else {
        const cashNeeded = B - tradeVal;
        const cost = tradeVal;
        const rate = A ? (tradeVal / A) * 100 : 0;

        $('cashLabel').textContent = 'Customer pays (cash) 💵';
        $('cashValue').textContent = fmtMoney(cashNeeded);
        $('costBasis').textContent = fmtMoney(cost);
        $('effectiveRate').textContent = fmtPercent(rate);
        $('effectiveRate').style.color = rateColor(rate);
        $('remainingValue').textContent = '$0.00';
        $('resultHint').textContent = 'Their trade value does not fully cover your card, so they top up with cash.';
        setCashTone(true);
      }
    }

    function resetForm() {
      $('theirValue').value = '';
      $('yourValue').value = '';
      $('tradePercent').value = 80;
      $('cashPercent').value = 70;
      calculate();
    }

    el.querySelector('[data-action="calculate"]').addEventListener('click', calculate);
    el.querySelector('[data-action="reset"]').addEventListener('click', resetForm);
    ['theirValue', 'yourValue', 'tradePercent', 'cashPercent'].forEach((id) => {
      $(id).addEventListener('blur', calculate);
    });

    calculate();
  },
});
