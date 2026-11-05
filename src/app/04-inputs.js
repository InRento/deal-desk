// Inputs tab: field definitions, deal types, layout by section, drawdown schedule, existing debts, sources & uses, LTV per tranche.
// ---- Inputs
const F = (k, label, kind = 'num', help = '', extra = {}) => ({ k, label, kind, help, ...extra });
const INPUT_SECTIONS = () => [
  ['1', 'General', [F('currency', 'Currency', 'text', 'Label only. Enter all amounts in this currency'), F('drawdown', 'Loan drawdown date', 'date', 'Period 1 = month of drawdown; month-end dates'), F('horizon', 'Projection horizon', 'int', 'Months, max 240. Extended to the loan term if shorter', { unit: 'mo' }), ...fxFields(), F('openingCash', 'Borrower opening cash at drawdown', 'money')]],
  ['2', 'Business cash flow (simple model, monthly)', [
    F('opModel', 'Operating model', 'select', 'Detailed: revenue and cost lines on the Operating model tab', { opts: [['simple', 'Simple (one revenue and one cost figure)'], ['detailed', 'Detailed (lines on Operating model tab)']] }),
    F('revenueSource', 'Revenue source', 'select', 'Sum of assets uses the rent column on Collateral & sales', { opts: [['manual', 'Enter manually'], ['assets', 'Sum of asset rents']], hideIf: (i) => i.opModel === 'detailed' }),
    F('revenue', 'Revenue per month', 'money', 'Base monthly revenue in year 1', { disabledIf: (i) => i.revenueSource === 'assets', hideIf: (i) => i.opModel === 'detailed' }),
    F('revGrowth', 'Revenue growth per year', 'pct', 'Step-up every 12 periods', { hideIf: (i) => i.opModel === 'detailed' }),
    F('opex', 'Operating expenses per month', 'money', 'Excluding loan interest and principal', { hideIf: (i) => i.opModel === 'detailed' }),
    F('opexGrowth', 'Expense growth per year', 'pct', '', { hideIf: (i) => i.opModel === 'detailed' }),
    F('cfStart', 'Business cash flow starts on', 'date', 'Blank = from drawdown. For developments, set the opening date', { hideIf: (i) => i.opModel === 'detailed' }),
    F('tax', 'Tax rate on profit (EBITDA − interest)', 'pct', 'Simple approximation, never negative'),
    F('otherDebt', 'Other existing debt service per month', 'money', 'Lenders that stay in place. Or list them under Existing debts'), F('otherDebtEnd', 'Other debt service ends on', 'date', 'Blank = whole horizon')]],
  ['3', 'InRento loan', [
    F('tranchesOn', 'Drawn in tranches', 'check', 'Off = full amount at drawdown. On = schedule below; the facility is the sum of tranches'),
    F('loansOn', 'Split into several loans', 'check', 'Each tranche belongs to a loan with its own fee, rate and interest reserve, collateral and repayment date. Sale proceeds repay Loan 1 first, then Loan 2. Borrower cash stays one combined view.', { hideIf: (i) => !i.tranchesOn }),
    F('trancheMode', 'Tranches released', 'select', 'Against progress: each tranche is drawn in the month the works reach its milestone (drawdown schedule, column "Works done")', { opts: [['dates', 'On their dates'], ['progress', 'Against construction progress']], hideIf: (i) => !i.tranchesOn || !i.constrOn }),
    F('loan', 'Loan amount', 'money', '', { hideIf: (i) => i.tranchesOn }),
    F('rate', 'Interest rate (annual, simple)', 'pct', 'Monthly interest = drawn balance × rate / 12'), F('term', 'Loan term', 'int', 'From drawdown, max 240', { unit: 'mo' }),
    F('repayType', 'Repayment type', 'select', '', { opts: E.REPAY.map((x) => [x, x]) }), F('grace', 'Interest-only grace period', 'int', 'Used only by the two “grace then…” types', { unit: 'mo' }),
    F('capitalise', 'Capitalise (roll up) interest during grace?', 'select', 'Bullet: Yes rolls up interest for the full term', { opts: [['No', 'No'], ['Yes', 'Yes']] }),
    F('payMonths', 'Interest paid in these months', 'months', 'Unticked months accrue interest that is paid in the next ticked month or at repayment (seasonal businesses)'),
    F('fixedGain', 'Fixed capital gain / catch-up (% p.a.)', 'pct', 'Accrues on the drawn balance, paid with each principal repayment (24 m at 1.5% = 3%)')]],
  ['3b', 'Extension and late repayment', [
    F('extOn', 'Model the extension option as used', 'check', 'Adds the extension months to the term'),
    F('extMonths', 'Extension period', 'int', '', { unit: 'mo', hideIf: (i) => !i.extOn }), F('extFee', 'Extension fee (% of balance at original maturity)', 'pct', '', { hideIf: (i) => !i.extOn }),
    F('extRate', 'Interest rate during extension', 'pct', 'Blank = same rate', { hideIf: (i) => !i.extOn }),
    F('defaultRate', 'Default interest rate (late repayment)', 'pct', 'Used by the “late repayment” stress on the Sensitivity tab. Blank = same rate')]],
  ['3c', 'Repayment from sales and cash', [
    F('saleVatMode', 'Sale prices are', 'select', 'Incl. VAT: the VAT part goes to the state, only the net price is proceeds that can repay the loan', { opts: [['excl', 'Excl. VAT (net)'], ['incl', 'Incl. VAT']] }),
    F('saleVatRate', 'VAT in sale prices', 'pct', '', { hideIf: (i) => i.saleVatMode !== 'incl' }),
    F('saleRepay', 'Asset sales repay the loan by', 'select', 'Release price = allocated loan × release % per unit (Collateral & sales)', { opts: [['sweep', 'Sweep % of sale price'], ['release', 'Release price per unit']] }),
    F('releasePct', 'Release price (% of allocated loan)', 'pct', 'Typically 110–125%'),
    F('sweepDefault', 'Default sales sweep (% of each sale)', 'pct', 'Rows with their own sweep % override this. 0% = off', { hideIf: (i) => i.saleRepay === 'release' }),
    F('sweepBasis', 'Sweep calculated on', 'select', '', { opts: [['Gross sale price', 'Gross sale price'], ['Net sale proceeds', 'Net sale proceeds']], hideIf: (i) => i.saleRepay === 'release' }),
    F('sweepApplies', 'Default sweep applies to', 'select', '', { opts: [['All asset sales', 'All asset sales'], ['Collateral sales only', 'Collateral sales only']], hideIf: (i) => i.saleRepay === 'release' }),
    F('intTiming', 'Interest is paid', 'select', 'From sale proceeds: interest accrues (not compounded) and is paid when a sale completes, or at maturity', { opts: [['monthly', 'Monthly by the borrower'], ['onSales', 'From sale proceeds when units sell']] }),
    F('saleOrder', 'Sale proceeds go first to', 'select', 'Interest first: interest due is paid out of each sale before principal, so the borrower is not asked for cash in a sale month', { opts: [['principalFirst', 'Principal (sweep), interest paid separately'], ['interestFirst', 'Interest due, then principal']] }),
    F('opSweepPct', 'Cash sweep from operations (% of cash above minimum)', 'pct', 'Pays down principal in the ticked months, before maturity'),
    F('opSweepMin', 'Minimum cash the borrower keeps', 'money', '', { hideIf: (i) => !E.pct(i.opSweepPct) }),
    F('opSweepMonths', 'Sweep in these months', 'months', '', { hideIf: (i) => !E.pct(i.opSweepPct) })]],
  ['4', 'Fees', [F('arrFee', 'Arrangement fee (% of loan)', 'pct'),
    F('feeBasis', 'Fee charged on', 'select', '', { opts: [['facility', 'Whole facility at first drawdown'], ['tranche', 'Each tranche when drawn']], hideIf: (i) => !i.tranchesOn }),
    F('feeTreatment', 'Fee is', 'select', 'Added to loan: borrower receives the full amount and repays the fee with principal', { opts: [['withheld', 'Withheld from the drawdown / paid in cash'], ['capitalised', 'Added to the loan balance']] }),
    F('commitFee', 'Commitment fee on undrawn amount (% p.a.)', 'pct', '', { hideIf: (i) => !i.tranchesOn }),
    F('reserveMonths', 'Interest reserve (months withheld)', 'num', 'Sized on the full facility; pays interest until used up', { unit: 'mo' }), F('prepayFee', 'Prepayment fee (% of principal swept before maturity)', 'pct'), F('exitFee', 'Exit fee (% of facility)', 'pct')]],
  ['4b', 'Investor returns on sales', [F('profitShare', "Profit share – investors' share of sale profit", 'pct', 'Per sale: (price × (1 − deduction) − notary − minimum price) × this %'), F('deduction', 'Deduction from sale price in profit formula', 'pct', 'InRento formula uses price × 0.97, i.e. 3%'), F('acctFee', 'Accounting fee ratio on profit share', 'pct', 'Share retained by InRento (info only)')]],
  ['5', 'Use of loan proceeds at drawdown', [
    F('refinanced', 'Existing debt refinanced (in addition to the table)', 'money'),
    F('purchaseSource', 'Purchase price source', 'select', 'Sum of assets uses the acquisition price column', { opts: [['manual', 'Enter manually'], ['assets', 'Sum of asset acquisition prices']] }),
    F('purchase', 'Purchase price / capex at drawdown', 'money', 'Later capex: add as expenses in Adjustments, funded by tranches', { disabledIf: (i) => i.purchaseSource === 'assets' }),
    F('closingCosts', 'Closing costs (notary, valuation, legal)', 'money'), F('otherUses', 'Other uses (working capital, tax arrears)', 'money'),
    F('equityAuto', 'Borrower equity = uses − first drawdown (auto)', 'check'),
    F('equity', 'Borrower equity contributed at drawdown', 'money', '', { disabledIf: (i) => i.equityAuto }),
    F('projectCost', 'Total project cost for LTC', 'money', 'Blank = uses at drawdown')]],
  ['8', 'Construction / renovation', [
    F('constrOn', 'Model construction / renovation', 'check', 'Budget, monthly spend, progress, tranches against progress, collateral value rising with the works'),
    F('worksStart', 'Works start', 'date', 'Blank = drawdown', { hideIf: (i) => !i.constrOn }),
    F('worksEnd', 'Completion', 'date', 'Blank = end of the loan term', { hideIf: (i) => !i.constrOn }),
    F('contingency', 'Contingency on the cost to complete', 'pct', 'Added to the remaining budget', { hideIf: (i) => !i.constrOn }),
    F('spendCurve', 'Spend over time', 'select', 'How the cost to complete is spread between works start and completion', { opts: [['even', 'Even per month'], ['scurve', 'S-curve (slow start and finish)'], ['manual', 'Monthly schedule per budget line']], hideIf: (i) => !i.constrOn }),
    F('fundingOrder', 'Works are funded', 'select', '', { opts: [['equityFirst', 'Borrower equity first, then the loan'], ['proRata', 'Equity and loan together (pro rata)']], hideIf: (i) => !i.constrOn }),
    F('constrEquity', 'Borrower equity for the works', 'money', 'Paid in as the works are built; costs it does not cover must come from tranches or other cash', { hideIf: (i) => !i.constrOn }),
    F('collCredit', 'Collateral credit for progress', 'pct', 'Value = as-is + this share of the uplift to the completed value, in line with progress; the full completed value from completion. 0% = as-is until completion', { hideIf: (i) => !i.constrOn }),
    F('costVatOn', 'VAT paid on construction costs', 'check', 'The budget is excl. VAT; VAT is paid with the costs and refunded later', { hideIf: (i) => !i.constrOn }),
    F('costVatRate', 'VAT rate on costs', 'pct', '', { hideIf: (i) => !i.constrOn || !i.costVatOn }),
    F('costVatLag', 'VAT refunded after', 'int', '', { unit: 'mo', hideIf: (i) => !i.constrOn || !i.costVatOn })]],
  ['6', 'Credit policy and exit', [F('haircut', 'Default forced-sale haircut', 'pct', 'Value × (1 − haircut) = lending value; own haircut per asset overrides'), F('sellCost', 'Selling costs (% of sale price)', 'pct'),
    F('maxLTV', 'Maximum acceptable LTV', 'pct'), F('targetCover', 'Target collateral coverage (lending value / loan)', 'num', 'e.g. 1.2. Used for loan sizing', { unit: '×' }),
    F('minDSCR', 'Minimum acceptable DSCR', 'num', '', { unit: '×' }),
    F('dscrBasis', 'DSCR test basis', 'select', '', { opts: [['rolling12', 'Rolling 12 months'], ['monthly', 'Monthly (each month)']] }),
    F('exitCap', 'Exit cap rate (EBITDA yield)', 'pct', 'Income value at maturity = trailing 12-month EBITDA / cap rate. Blank = collateral value'),
    F('refiLTV', 'Bank LTV for refinancing at exit', 'pct', 'Blank = no refinancing test')]],
];
function fieldHTML(f, obj, base) {
  if (f.hideIf && f.hideIf(obj)) return '';
  const path = base + f.k, id = idOf(path), val = obj[f.k];
  const dis = f.disabledIf && f.disabledIf(obj);
  let ctl;
  if (f.kind === 'select') ctl = sel(path, val, f.opts);
  else if (f.kind === 'check') ctl = chk(path, val);
  else if (f.kind === 'date') ctl = dateIn(path, val);
  else if (f.kind === 'months') return `<div class="f fm"><span class="lbl">${esc(f.label)}</span>${monthChips(path, val, f.label)}${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</div>`;
  else ctl = `<input class="in" id="${id}" data-k="${path}" data-kind="${f.kind}" inputmode="decimal" autocomplete="off" value="${esc(val)}" ${dis ? 'disabled' : ''}>`;
  const unit = f.kind === 'pct' ? '%' : f.kind === 'money' ? moneyUnit() : (f.unit || '');
  return `<label class="f" for="${id}"><span class="lbl">${esc(f.label)}</span><span class="ctl">${ctl}<span class="unit">${unit}</span></span>${['pct', 'money', 'num', 'int'].includes(f.kind) ? `<span class="hint" data-hint="${id}"></span>` : ''}${f.help ? `<span class="help">${esc(f.help)}</span>` : ''}</label>`;
}
const card = ([n, t, fs], i) => `<div class="card"><h2 style="margin-bottom:8px"><span class="secnum">${n}</span>${esc(t)}</h2><div class="form">${fs.map((f) => fieldHTML(f, i, 'inputs.')).join('')}</div>${n === '1' ? fxButton(i) : ''}</div>`;
const noFx = (i) => String(i.currency || 'EUR').trim().toUpperCase() === 'EUR';
const fxFields = () => [F('fxRate', 'Exchange rate (units per 1 EUR)', 'num', 'For the EUR view and the €5m check, e.g. 4.25 PLN per EUR', { hideIf: noFx }), F('fxDate', 'Exchange rate date', 'date', '', { hideIf: noFx })];
const fxButton = (i) => noFx(i) ? '' : `<div class="row" style="gap:8px;margin-top:8px"><button class="btn sm" data-act="fx-ecb">Get today's ECB rate</button>${E.num(i.fxRate) > 0 ? `<span class="sub">1 EUR = ${esc(i.fxRate)} ${esc(String(i.currency).toUpperCase())}${i.fxDate ? ' · ' + esc(i.fxDate) : ''}</span>` : ''}</div>`;
function trancheCard() {
  const p = cur();
  if (!p.inputs.tranchesOn) return '';
  const prog = p.inputs.constrOn && p.inputs.trancheMode === 'progress', ml = loansUsed(p), drawnIn = prog || ml; // several loans: which loan, released when, drawn in
  const relCell = (t, i) => `<td class="w-rel"><div class="relc">${sel(`tranches.${i}.trigger`, t.trigger === 'balance' ? 'balance' : '', [['', prog ? 'Works done / date' : 'On its date'], ['balance', 'Loan balance below']])}${t.trigger === 'balance' ? inp(`tranches.${i}.trigAmount`, t.trigAmount, 'money', 'placeholder="amount"') : ''}</div></td>`;
  return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Drawdown schedule</h3><span class="row" style="gap:6px"><button class="btn sm" data-act="paste-table" data-t="tranches" title="Paste rows copied from Excel">Paste from Excel</button><button class="btn sm" data-act="add-tranche">Add tranche</button></span></div>
    <div class="sub" style="margin-bottom:8px">${ml ? 'Loan balance below: the tranche is paid out at the start of the month after the total loan balance falls below the amount (the date, if set, is the earliest month). Stresses move it with the sales. ' : ''}${prog ? 'Released against progress: a tranche with "Works done" is drawn at the start of the month the works reach that share (blank = on its date). Delays and slower spending move it automatically.' : 'A tranche dated in the drawdown month is paid out at drawdown; later tranches at the start of their month.'}</div>
    <div class="tblwrap"><table class="grid-in"><thead><tr><th>${prog ? 'Date (if no milestone)' : 'Date'}</th><th class="n">Amount</th>${ml ? '<th>Loan</th><th>Released when</th>' : ''}${prog ? '<th class="n" title="Share of the whole works completed, incl. what was spent before drawdown">Works done %</th>' : ''}${drawnIn ? '<th class="n">Drawn in</th>' : ''}<th>Milestone / condition</th><th class="n">Cumulative</th><th class="n" title="Loan balance after this draw ÷ collateral market value in that month">LTV after draw</th><th class="n" title="Loan balance ÷ lending value (after haircuts)">LTV forced</th><th></th></tr></thead><tbody>
    ${p.tranches.map((t, i) => `<tr><td>${dateIn(`tranches.${i}.date`, t.date)}</td><td>${inp(`tranches.${i}.amount`, t.amount, 'money')}</td>${ml ? `<td class="w-loan">${sel(`tranches.${i}.loan`, String(Math.min(p.loans.length, Math.max(1, Math.round(E.num(t.loan, 1))))), loanOpts(p))}</td>${relCell(t, i)}` : ''}${prog ? `<td class="w-s">${inp(`tranches.${i}.milestone`, t.milestone, 'pct')}</td>` : ''}${drawnIn ? `<td class="calcc" data-out="trw-${i}"></td>` : ''}<td class="w-name">${inp(`tranches.${i}.label`, t.label, 'text')}</td><td class="calcc" data-out="tr-${i}"></td><td class="calcc" data-out="trl-${i}"></td><td class="calcc" data-out="trf-${i}"></td><td><button class="xbtn" data-act="del-tranche" data-i="${i}" aria-label="Remove tranche">×</button></td></tr>`).join('') || `<tr><td colspan="${7 + (prog ? 2 : drawnIn ? 1 : 0) + (ml ? 2 : 0)}" class="sub">No tranches yet.</td></tr>`}
    </tbody><tfoot><tr><td>Facility</td><td data-out="tr-total"></td><td colspan="${2 + (prog ? 1 : 0) + (drawnIn ? 1 : 0) + (ml ? 2 : 0)}"></td><td data-out="trl-max"></td><td data-out="trf-max"></td><td></td></tr></tfoot></table></div></div>`;
}
OUT['tr-total'] = () => money(S.model.r.facility);
function debtCard() {
  const p = cur();
  return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Existing debts</h3><span class="row" style="gap:6px"><button class="btn sm" data-act="paste-table" data-t="debts" title="Paste rows copied from Excel">Paste from Excel</button><button class="btn sm" data-act="add-debt">Add debt</button></span></div>
    <div class="sub" style="margin-bottom:8px">Refinanced debts (balance + prepayment cost) are paid from the loan at drawdown. Debts that stay have their monthly service in the borrower's cash flow and DSCR.</div>
    ${p.debts.length ? `<div class="tblwrap"><table class="grid-in"><thead><tr><th>Lender</th><th class="n">Balance</th><th class="n">Rate %</th><th>Maturity</th><th class="n">Prepayment cost</th><th>Refinanced</th><th class="n">Monthly service (if stays)</th><th>Service ends</th><th>Notes</th><th></th></tr></thead><tbody>
    ${p.debts.map((d, i) => `<tr><td class="w-name">${inp(`debts.${i}.lender`, d.lender, 'text')}</td><td>${inp(`debts.${i}.balance`, d.balance, 'money')}</td><td class="w-s">${inp(`debts.${i}.rate`, d.rate, 'pct')}</td><td>${dateIn(`debts.${i}.maturity`, d.maturity)}</td><td>${inp(`debts.${i}.prepay`, d.prepay, 'money')}</td><td class="c">${chk(`debts.${i}.refinanced`, d.refinanced !== false, 'Refinanced')}</td><td>${inp(`debts.${i}.service`, d.service, 'money')}</td><td>${dateIn(`debts.${i}.end`, d.end)}</td><td class="w-name">${inp(`debts.${i}.notes`, d.notes, 'text')}</td><td><button class="xbtn" data-act="del-debt" data-i="${i}" aria-label="Remove debt">×</button></td></tr>`).join('')}
    </tbody><tfoot><tr><td>Refinanced total</td><td data-out="debt-refi"></td><td colspan="8"></td></tr></tfoot></table></div>` : '<div class="sub">No existing debts listed.</div>'}</div>`;
}
OUT['debt-refi'] = () => plain(S.model.r.refiTable);
function tabInputs() { return tabInputsTyped(); }
OUT.helpers = () => {
  const r = S.model.r, s = S.model.summary;
  const c = (k, v) => `<div class="calc"><span>${k}</span><span class="num">${v}</span></div>`;
  return c('Facility', money(r.facility)) + c('Paid out at drawdown', money(r.draw0)) + c('Revenue per month used (simple model)', money(r.revenue)) + c('Purchase / capex used', money(r.purchase)) + c('Debt refinanced (total)', money(r.refi)) + c('Borrower equity used', money(r.equity)) +
    c('Amortisation method', r.amort) + c('Interest-only months', r.ioMonths) + c('Term incl. extension', r.term + ' months') + c('Effective horizon', r.horizon + ' months') +
    c('Arrangement fee', money(s.arrFeeAmt)) + c('Interest reserve', money(s.reserveAmt)) +
    c('Net cash to borrower at drawdown', `<span class="${s.netCash < 0 ? 'bad-t' : ''}">${money(s.netCash)}</span>`) + c('Project cost used for LTC', money(r.projectCost)) + c('Contractual maturity', dayf(s.maturity));
};

// ================= Deal types, model checks (mistake catcher), sources & uses =================
const DEAL_TYPES = [
  ['units', 'Units for sale', 'Conversion, renovation or completed stock. Repaid from unit sales.'],
  ['operating', 'Operating business', 'Hotel, resort, spa, care home, leisure. Repaid from operations, then exit.'],
  ['rental', 'Rental / buy-to-let', 'Rented flats, co-living, commercial lets. Repaid from rent, then refinancing or sale.'],
  ['bridge', 'Whole-asset sale bridge', 'Repaid by selling the whole property or a few large assets.'],
  ['custom', 'Custom', 'Everything visible, nothing preset. For unusual structures.'],
];
const UNIT_COLS = ['status', 'listPrice', '=vsList', 'deposit', 'depositHeld', '=beM2'];
const TYPE_CFG = {
  units: { open: ['1', '3', '3b', '3c', '4', '4b', '5', '6'], hideTabs: ['ops'], hideCols: ['rent'], defaults: { saleRepay: 'sweep', sweepDefault: '100', saleOrder: 'interestFirst', opModel: 'simple' } },
  operating: { open: ['1', '2', '3', '3b', '4', '5', '6'], seas: true, hideCols: UNIT_COLS, defaults: { dscrBasis: 'rolling12', minDSCR: '1.2' } },
  rental: { open: ['1', '2', '3', '3b', '4', '5', '6'], hideTabs: ['ops'], hideCols: UNIT_COLS, defaults: { revenueSource: 'assets', minDSCR: '1.2' } },
  bridge: { open: ['1', '3', '3b', '3c', '4', '5', '6'], hideTabs: ['ops'], hideCols: ['rent', ...UNIT_COLS], defaults: { saleRepay: 'sweep', sweepDefault: '100', saleOrder: 'interestFirst', opModel: 'simple' } },
  custom: { open: null },
};
const typeOf = (p) => (p && TYPE_CFG[p.inputs.dealType] ? p.inputs.dealType : 'custom');
const typeLabel = (t) => (DEAL_TYPES.find((d) => d[0] === t) || DEAL_TYPES[4])[1];
const hasOps = (p) => p.inputs.opModel === 'detailed' || p.revLines.length > 0 || p.costLines.length > 0;
function visibleTabs() {
  const p = cur(); if (!p || p.inputs.showAll) return TABS;
  const hide = TYPE_CFG[typeOf(p)].hideTabs || [];
  return TABS.filter((t) => !hide.includes(t[0]) || (t[0] === 'ops' && hasOps(p)) || S.tab === t[0]);
}
function acols() {
  const p = cur(); const hide = (p.inputs.showAll ? [] : (TYPE_CFG[typeOf(p)].hideCols || [])).concat(p.inputs.constrOn ? [] : ['marketDone']).concat(planUsed(p) ? [] : ['contractDate', 'payPlan', '=pays']).concat(loansUsed(p) ? [] : ['secures']); // value on completion only with construction; payment plan columns only when a plan is used
  return ACOLS.filter((c) => !hide.includes(c[0]) || (c[0][0] !== '=' && p.assets.some((a) => !E.blank(a[c[0]]))));
}
const looksNew = (p) => !E.num(p.inputs.loan) && !p.tranches.length && p.assets.every((a) => !a.name && E.blank(a.market));
function setDealType(t) {
  const p = cur(); if (!p || !TYPE_CFG[t]) return;
  const fresh = looksNew(p);
  p.inputs.dealType = t;
  if (fresh) Object.assign(p.inputs, TYPE_CFG[t].defaults || {});
  scheduleSave(S.curId); recalc(true); render();
  toast(`Deal type: ${typeLabel(t)}${fresh && TYPE_CFG[t].defaults ? ' · defaults applied' : ''}`);
}
function typePicker() {
  const p = cur(); if (p.inputs.dealType) return '';
  return `<div class="card typepick"><h3>What kind of deal is this?</h3><div class="sub" style="margin-bottom:10px">Sets which inputs come first and which mistakes to look for. Nothing is removed: "Show all inputs" on the Inputs tab brings everything back, and you can change the type at any time.</div>
    <div class="typegrid">${DEAL_TYPES.map(([k, l, d]) => `<button class="typebtn" data-act="set-type" data-t="${k}"><b>${esc(l)}</b><span>${esc(d)}</span></button>`).join('')}</div></div>`;
}
const typeSelect = (p) => `<label class="row" style="gap:6px" for="${idOf('inputs.dealType')}"><span class="sub">Deal type</span>${sel('inputs.dealType', p.inputs.dealType || '', [['', 'Not set (all inputs)'], ...DEAL_TYPES.map((d) => [d[0], d[1]])], 'style="width:auto"')}</label>`;

// ---- Inputs layout by deal type
const DEF_IN = DEFAULT_INPUTS();
const isDefault = (k, v) => JSON.stringify(v ?? '') === JSON.stringify(DEF_IN[k] ?? '') || (E.blank(v) && E.blank(DEF_IN[k])) || (!E.blank(v) && !E.blank(DEF_IN[k]) && E.num(v) === E.num(DEF_IN[k]) && !isNaN(+v));
// The Inputs tab follows the order a deal is built in: deal → loan → uses at drawdown → repayment → business → policy.
// Each section shows its everyday fields; rarer terms sit under "More …" and move up by themselves once they hold a value.
const IN_LAYOUT = [
  { id: 'deal', t: 'Deal', main: ['drawdown', 'currency', 'fxRate', 'fxDate', 'horizon', 'openingCash'], more: [] },
  { id: 'loan', t: 'Loan', main: ['tranchesOn', 'trancheMode', 'loansOn', 'loan', 'rate', 'term', 'fixedGain', 'arrFee', 'feeTreatment', 'feeBasis', 'repayType'],
    more: ['grace', 'capitalise', 'payMonths', 'reserveMonths', 'commitFee', 'prepayFee', 'exitFee', 'extOn', 'extMonths', 'extFee', 'extRate', 'defaultRate', 'profitShare', 'deduction', 'acctFee'] },
  { id: 'uses', t: 'Uses at drawdown', main: ['purchaseSource', 'purchase', 'closingCosts', 'otherUses', 'equityAuto', 'equity'], more: ['refinanced', 'projectCost'] },
  { id: 'works', t: 'Construction / renovation', main: ['constrOn', 'worksStart', 'worksEnd', 'contingency', 'spendCurve', 'fundingOrder', 'constrEquity', 'collCredit'], more: ['costVatOn', 'costVatRate', 'costVatLag'] },
  { id: 'repay', t: 'Repayment', main: ['saleVatMode', 'saleVatRate', 'saleRepay', 'releasePct', 'sweepDefault', 'intTiming', 'saleOrder'], more: ['sweepBasis', 'sweepApplies', 'opSweepPct', 'opSweepMin', 'opSweepMonths'] },
  { id: 'ops', t: 'Business cash flow', main: ['opModel', 'revenueSource', 'revenue', 'revGrowth', 'opex', 'opexGrowth', 'cfStart'], more: ['tax', 'otherDebt', 'otherDebtEnd'] },
  { id: 'policy', t: 'Credit policy and exit', main: ['maxLTV', 'haircut', 'sellCost', 'minDSCR'], more: ['targetCover', 'dscrBasis', 'exitCap', 'refiLTV'] },
];
const OPS_FIRST = new Set(['operating', 'rental', 'custom']);
const OPEN_SECS = new Set(); // sections whose "More …" is open
const inSecOf = (k) => (IN_LAYOUT.find((s) => s.main.includes(k) || s.more.includes(k)) || {}).id;
function tabInputsTyped() {
  const p = cur(), i = p.inputs, t = typeOf(p), all = !!i.showAll;
  const FD = {}; for (const [, , fs] of INPUT_SECTIONS()) for (const f of fs) FD[f.k] = f;
  if (FD.releasePct && !FD.releasePct.hideIf) FD.releasePct = Object.assign({}, FD.releasePct, { hideIf: (x) => x.saleRepay !== 'release' });
  const cell = (k) => { const f = FD[k]; if (!f || (f.hideIf && f.hideIf(i))) return ''; return `<div class="iq-c${f.kind === 'months' ? ' wide' : ''}${f.kind === 'check' ? ' ck' : ''}">${fieldHTML(f, i, 'inputs.')}</div>`; };
  const DEP = { deduction: 'profitShare', acctFee: 'profitShare', opSweepMin: 'opSweepPct', opSweepMonths: 'opSweepPct' }; // only worth showing when the parent term is used
  const isSet = (k) => FD[k] && FD[k].kind !== 'months' && !isDefault(k, i[k]) && (!DEP[k] || !isDefault(DEP[k], i[DEP[k]]));
  const opsOn = OPS_FIRST.has(t) || all || S.iqOps === p.id || hasOps(p) || ['revenue', 'opex', 'cfStart', 'tax', 'otherDebt'].some(isSet);
  const seasSet = (i.seasonality || []).some((v) => E.num(v, 1) !== 1);
  const seas = i.opModel === 'detailed' ? '' : `<div class="iq-sub"><div class="iq-subh">Seasonality <span class="sub">revenue multiplier by calendar month, 1.00 = average</span></div>
    <div class="iq-seas">${MON.map((m, k) => `<label for="${idOf('inputs.seasonality.' + k)}"><span class="sub">${m}</span>${inp('inputs.seasonality.' + k, i.seasonality[k], 'num')}</label>`).join('')}</div></div>`;
  const extra = {
    deal: fxButton(i),
    loan: i.tranchesOn ? `<div class="iq-sub">${loansUsed(p) ? loansCard() : ''}${trancheCard()}</div>` : '',
    works: i.constrOn ? `<div class="iq-sub">${constrCard()}</div>` : '',
    repay: p.assets.some((a) => !E.blank(a.salePrice)) || planUsed(p) ? `<div class="iq-sub">${payPlanCard()}</div>` : '',
    uses: `<div class="iq-sub">${debtCard()}</div>`,
    ops: (OPS_FIRST.has(t) || seasSet || all) ? seas : '',
  };
  const sec = (S_) => {
    const moreOpen = all || OPEN_SECS.has(S_.id);
    const promoted = S_.more.filter(isSet), rest = S_.more.filter((k) => !promoted.includes(k));
    const restCells = rest.map(cell).filter(Boolean);
    const more = restCells.length ? `<details class="iq-more" data-sec="${S_.id}" ${moreOpen ? 'open' : ''}><summary>More ${S_.t.toLowerCase()} options</summary><div class="iq-grid">${restCells.join('')}</div></details>` : '';
    const grid = `<div class="iq-grid">${[...S_.main, ...promoted].map(cell).join('')}</div>`;
    const top = S_.id === 'uses' ? `<div class="iq-uses">${grid}<div class="iq-su"><div class="iq-subh">Sources &amp; uses at drawdown</div><div data-out="su"></div></div></div>` : grid;
    return `<section class="card iq-sec" id="iq-${S_.id}"><h2>${esc(S_.t)}</h2>${top}${S_.id === 'uses' ? more : ''}${extra[S_.id] || ''}${S_.id === 'uses' ? '' : more}</section>`;
  };
  const shown = IN_LAYOUT.filter((x) => x.id !== 'ops' || opsOn), hidden = IN_LAYOUT.filter((x) => !shown.includes(x));
  const nav = shown.map((x) => `<a href="#iq-${x.id}" data-act="iq-jump" data-s="${x.id}">${esc(x.t)}</a>`).join('');
  return `${ccyNote(p)}<div class="row iq-top"><div class="sub" title="Amounts accept sums like 17000/12. Percentages in percent (8.5 = 8.5%). Enter moves to the next field. Right-click a field to note its source.">Yellow cells are inputs · 8.5 = 8.5%</div>
    <div class="row" style="gap:14px">${typeSelect(p)}<label class="row" style="gap:6px">${chk('inputs.showAll', i.showAll, 'Show all inputs')}<span class="sub">Show all inputs</span></label></div></div>
  <div class="iq">
    <div class="iq-main">${shown.map(sec).join('')}
      ${hidden.length ? `<div class="card iq-sec iq-off">${hidden.map((x) => `<button class="btn sm" data-act="iq-show-ops">+ ${esc(x.t)}</button>`).join('')}<span class="sub">Not usually needed for ${esc(typeLabel(t))}. Anything entered there still counts.</span></div>` : ''}
      <details class="card iq-sec"><summary><b>Calculated values</b></summary><div data-out="helpers" class="helpers" style="margin-top:10px"></div></details>
    </div>
    <aside class="iq-rail"><div class="card"><nav class="iq-nav">${nav}</nav><div data-out="iqrail"></div></div></aside>
  </div>`;
}
document.addEventListener('toggle', (e) => { const d = e.target; if (d.classList && d.classList.contains('iq-more')) { if (d.open) OPEN_SECS.add(d.dataset.sec); else OPEN_SECS.delete(d.dataset.sec); } }, true);
// live results next to the inputs, so there is no need to switch tabs while modelling
OUT.iqrail = () => {
  const m = S.model, s = m.summary, r = m.r, T = mgTests(r), p = cur();
  const first = r.tranchesOn && r.tranches.length ? r.tranches[0].amount : s.facility;
  const repay = T.repay(s), cash = T.cash(s);
  const short = -(s.cashAtMaturity + (T.refi && s.refiMax != null ? Math.min(s.refiMax, s.owedAtExit || 0) : 0));
  let ii = null; try { ii = investorIrr(m); } catch (e) { /* model without cash flows */ }
  const n = lintCount(p, m);
  const row = (l, v, c = '', sub = '', tr = '') => `<div class="iq-r"><span class="l">${l}</span><span class="v ${c}"${tr ? ` data-tr="m:${tr}"` : ''}>${v}</span>${sub ? `<span class="s">${sub}</span>` : ''}</div>`;
  return row(r.tranchesOn ? 'Facility' : 'Loan', money(s.facility), '', r.tranchesOn ? `${money(s.draw0)} at drawdown` : '', 'facility') +
    row('LTV', pctf(s.ltv0), s.ltv0 > r.maxLTV ? 'bad' : '', r.tranchesOn ? `first tranche ${s.mkt0 > 0 ? pctf(first / s.mkt0) : '–'} · max ${pctf(r.maxLTV, 0)}` : `max ${pctf(r.maxLTV, 0)}`, 'ltv0') +
    row('Net cash at drawdown', money(s.netCash), s.netCash < -1 ? 'bad' : '', s.netCash < -1 ? 'funding gap' : s.netCash > 1 ? 'paid to the borrower' : 'balanced', 'netCash') +
    row('Borrower lowest cash', money(s.lowCashPre), cash ? '' : 'bad', s.lowCashPreDate ? `in ${mgMonth(s.lowCashPreDate)}` : '', 'lowCashPre') +
    row('Loan repaid', repay ? (s.repaidDate ? mgMonth(s.repaidDate) : 'at maturity') : `${money(Math.max(0, short))} short`, repay ? 'good' : 'bad', `maturity ${mgMonth(s.maturity)}`) +
    row('Investor IRR', ii == null ? '–' : pctf(ii, 1)) +
    row('InRento fee', money(s.loans ? s.arrFeeAmt : s.fee0 || s.arrFeeAmt), '', '', 'arrFeeAmt') +
    `<button class="btn sm iq-chk ${n ? 'warn' : ''}" data-act="goto-check">${n ? `${n} to check` : 'Model check: OK'}</button>`;
};
document.addEventListener('click', (e) => {
  const b = e.target.closest && e.target.closest('[data-act="iq-jump"],[data-act="iq-show-ops"]'); if (!b) return;
  e.preventDefault();
  if (b.dataset.act === 'iq-show-ops') { S.iqOps = cur().id; renderTab(); setTimeout(() => { const el = $('#iq-ops'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, 30); return; }
  const el = $('#iq-' + b.dataset.s); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
// Enter moves to the next input, like a spreadsheet
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.shiftKey || e.metaKey || e.ctrlKey || S.tab !== 'inputs') return;
  const el = e.target; if (!el.matches || !el.matches('.iq input.in, .iq select')) return;
  e.preventDefault();
  const all = [...document.querySelectorAll('.iq input.in:not([disabled]), .iq select:not([disabled]), .iq input[type=date]:not([disabled])')].filter((x) => x.offsetParent);
  const nx = all[all.indexOf(el) + 1]; if (nx) { nx.focus(); if (nx.select) nx.select(); }
});

// ---- Sources & uses (replaces the earlier list)
OUT.su = () => {
  const s = S.model.summary, r = S.model.r;
  const line = (k, v, o = {}) => `<div class="kv ${o.tot ? 'tot' : ''}"><span class="k ${o.ind ? 'ind' : ''}">${k}</span><span class="v ${o.c || ''}">${v}</span></div>`;
  const src = s.draw0 + s.equity, fee = r.feeCap ? 0 : s.fee0;
  const uses = s.refi + s.purchase + s.closing + s.otherUses + fee + s.reserveAmt;
  const gap = s.netCash;
  let html = `<div class="su"><div><div class="suh">Sources</div>${line(r.tranchesOn ? 'Loan paid out at drawdown' : 'Loan', money(s.draw0))}${s.equity ? line('Borrower equity' + (cur().inputs.equityAuto ? ' (auto)' : ''), money(s.equity)) : ''}${line('Total sources', money(src), { tot: 1 })}</div>
    <div><div class="suh">Uses</div>${[['Existing debt refinanced', s.refi], ['Purchase / capex at drawdown', s.purchase], ['Closing costs', s.closing], ['Other uses <span class="sub">(outside the security)</span>', s.otherUses, 'warn-t'], ['Arrangement fee withheld', fee], ['Interest reserve withheld', s.reserveAmt]].filter((u) => Math.abs(u[1]) > 0.5).map((u) => line(u[0], money(u[1]), { c: u[2] || '' })).join('') || line('Nothing entered', '–')}${line('Total uses', money(uses), { tot: 1 })}</div></div>`;
  html += `<div class="sugap ${gap < -1 ? 'bad' : gap > 1 ? 'pos' : 'ok'}">${gap < -1 ? `<b>Funding gap ${money(-gap)}</b> – uses exceed sources. Someone has to pay this at drawdown.` : gap > 1 ? `<b>Surplus ${money(gap)}</b> – cash the borrower receives at drawdown.` : '<b>Balanced</b> – sources cover uses.'}</div>`;
  if (gap < -1 && viewEUR()) html += `<div class="note" style="margin-top:6px">Shown in EUR at ${cur().inputs.fxRate} ${esc(baseCcy(cur()))}/EUR. Switch to ${esc(baseCcy(cur()))} to use the fix buttons.</div>`;
  else if (gap < -1) {
    const gu = s.grossUp != null && s.grossUp > 0 ? Math.ceil(s.grossUp / 1000) * 1000 : null;
    html += `<div class="row" style="gap:6px;margin-top:8px">${gu && !r.tranchesOn ? `<button class="btn sm" data-act="su-grossup" data-v="${gu}">Gross up loan to ${money(gu)}</button>` : ''}<button class="btn sm" data-act="su-equity" data-v="${Math.ceil(-gap)}">Borrower brings ${money(-gap)} equity</button></div>
      <div class="note" style="margin-top:6px">Gross-up = uses ÷ (1 − fee − reserve months × rate / 12), so the fee and reserve are funded by the loan itself.</div>`;
  }
  return html;
};

// ================= LTV at each tranche =================
function trancheCalcs() { // cumulative amount and LTV after each tranche
  let c = 0; const out = {};
  cur().tranches.forEach((t, i) => { c += E.num(t.amount); out[`tr-${i}`] = plain(c); });
  const L = trancheLtv(), max = S.model ? S.model.r.maxLTV : 0.7;
  const f = (v) => (v == null ? '–' : `<span class="${v > max ? 'bad-t' : ''}">${pctf(v)}</span>`);
  L.forEach((x, i) => { out[`trl-${i}`] = x ? f(x.ltv) : '–'; out[`trf-${i}`] = x ? f(x.fs) : '–'; });
  const ok = L.filter(Boolean);
  out['trl-max'] = ok.length ? 'max ' + f(Math.max(...ok.map((x) => x.ltv || 0))) : '';
  out['trf-max'] = ok.length ? 'max ' + f(Math.max(...ok.map((x) => x.fs || 0))) : '';
  if (S.model && (S.model.r.progressMode || S.model.r.loans)) cur().tranches.forEach((t, i) => { const tp = tranchePeriod(S.model, i); out[`trw-${i}`] = tp == null ? (S.model.r.loans && !E.blank(t.amount) ? '<span class="bad-t">not released</span>' : '–') : `<span data-tr="c:draw:${tp}">${tp ? datef(S.model.rows[tp].date) : 'drawdown'}</span>`; });
  return constrCalcs(out);
}
// ---- Construction budget: lines, cost to complete, monthly schedule (manual curve)
function worksMonths() { const r = S.model && S.model.r, c = r && r.constr; if (!c) return []; const out = []; for (let pp = c.startP; pp <= c.endP; pp++) out.push(E.eomonth(r.drawdown, pp - 1)); return out; }
function constrCard() {
  const p = cur(), i = p.inputs, manual = i.spendCurve === 'manual', mons = manual ? worksMonths() : [];
  return `<div class="card"><div class="row" style="justify-content:space-between;margin-bottom:8px"><h3 style="margin:0">Construction budget</h3><span class="row" style="gap:6px"><button class="btn sm" data-act="add-constr">Add budget line</button></span></div>
    <div class="sub" style="margin-bottom:8px">Amounts excl. VAT. "Spent to date" = already paid before drawdown (from the monitoring report); the rest plus contingency is the cost to complete, spent between works start and completion${manual ? ' as in the monthly schedule below' : ''}.</div>
    <div class="tblwrap"><table class="grid-in"><thead><tr><th>Budget line</th><th class="n">Budget</th><th class="n">Spent to date</th><th class="n">To complete incl. contingency</th><th></th></tr></thead><tbody>
    ${p.constrLines.map((l, k) => `<tr><td class="w-name">${inp(`constrLines.${k}.name`, l.name, 'text')}</td><td>${inp(`constrLines.${k}.budget`, l.budget, 'money')}</td><td>${inp(`constrLines.${k}.spent`, l.spent, 'money')}</td><td class="calcc" data-out="cw-${k}"></td><td><button class="xbtn" data-act="del-constr" data-i="${k}" aria-label="Remove budget line">×</button></td></tr>`).join('') || '<tr><td colspan="5" class="sub">No budget lines yet – add the works budget (e.g. shell, engineering, finishes, soft costs).</td></tr>'}
    </tbody><tfoot><tr><td>Total</td><td data-out="cw-budget"></td><td data-out="cw-spent"></td><td data-out="cw-rem"></td><td></td></tr></tfoot></table></div>
    <div data-out="cw-sum" class="cwsum"></div>
    ${manual ? (mons.length ? `<div class="iq-subh" style="margin-top:14px">Monthly schedule (cost to complete, excl. contingency)</div><div class="sub" style="margin-bottom:6px">The shape of each line's spending. Totals that differ from the remaining budget are scaled to it (the model check says so).</div>
      <div class="tblwrap"><table class="grid-in"><thead><tr><th>Budget line</th>${mons.map((d) => `<th class="n">${datef(d)}</th>`).join('')}<th class="n">Total</th></tr></thead><tbody>
      ${p.constrLines.map((l, k) => `<tr><td>${esc(l.name || 'Line ' + (k + 1))}</td>${mons.map((d, j) => `<td>${inp(`constrLines.${k}.sched.${j}`, (l.sched || [])[j] ?? '', 'money', 'style="min-width:78px"')}</td>`).join('')}<td class="calcc" data-out="cws-${k}"></td></tr>`).join('')}</tbody></table></div>` : '<div class="sub" style="margin-top:10px">Set works start and completion to fill the monthly schedule.</div>') : ''}</div>`;
}
function constrCalcs(out) {
  const m = S.model, p = cur(); if (!m || !m.r.constr) return out;
  const c = m.r.constr;
  p.constrLines.forEach((l, k) => { out[`cw-${k}`] = plain(Math.max(0, E.num(l.budget) - E.num(l.spent)) * (1 + c.cont)); out[`cws-${k}`] = plain((l.sched || []).reduce((s, v) => s + E.num(v), 0)); });
  out['cw-budget'] = plain(p.constrLines.reduce((s, l) => s + E.num(l.budget), 0)); out['cw-spent'] = plain(c.spentToDate); out['cw-rem'] = plain(c.remaining);
  const s = m.summary;
  out['cw-sum'] = `<div class="kv"><span class="k">Total cost of the works</span><span class="v" data-tr="m:worksTotal">${money(s.worksTotal)}</span></div><div class="kv"><span class="k">Done at drawdown</span><span class="v" data-tr="c:progress:0">${pctf(s.progress0)}</span></div><div class="kv"><span class="k">Completion</span><span class="v">${datef(s.completion)}</span></div><div class="kv"><span class="k">Borrower equity used for the works</span><span class="v">${money(s.worksEquity)}</span></div><div class="kv"><span class="k">Lowest borrower cash during the works</span><span class="v ${s.lowCashWorks < 0 ? 'bad-t' : ''}" data-tr="m:lowCashWorks">${money(s.lowCashWorks)}${s.lowCashWorksDate ? ` <span class="sub">${datef(s.lowCashWorksDate)}</span>` : ''}</span></div>`;
  return out;
}
// the cash-flow period a tranche is drawn in: its date, or (against progress) the month the works reach its milestone
function tranchePeriod(m, i) {
  const r = m.r;
  if (r.loans) { const q = m.k.TR.find((x) => x.t.idx === i); return q ? q.drawP : null; } // several loans: the month its trigger is met (null = never)
  if (!r.progressMode) return null;
  const k = r.tranches.findIndex((t) => t.idx === i); return k < 0 ? null : r.trancheAt[k];
}
function trancheLtv(pp) {
  const m = S.model; if (!m || !m.r.tranchesOn) return [];
  const p = pp || cur(), dd = m.r.drawdown, rows = m.rows;
  return p.tranches.map((t, i) => {
    if (E.blank(t.amount)) return null;
    const tp = tranchePeriod(m, i), d = E.parseDate(t.date); if (tp == null && (d == null || m.r.loans)) return null;
    const row = tp != null ? rows[tp] : d <= E.eomonth(dd, 0) ? rows[0] : rows.find((x) => x.p > 0 && x.date >= d);
    if (!row) return null;
    return { p: row.p, date: row.date, bal: row.close, ltv: row.collMkt > 0 ? row.close / row.collMkt : null, fs: row.collFs > 0 ? row.close / row.collFs : null };
  });
}

function lintTranches(p, m, add) { // LTV after each tranche
  if (m.r.tranchesOn) {
    const keep = S.model; S.model = m; let L; try { L = trancheLtv(p); } finally { S.model = keep; }
    let worst = -1; L.forEach((x, i) => { if (x && x.ltv != null && x.ltv > m.r.maxLTV && (worst < 0 || x.ltv > L[worst].ltv)) worst = i; });
    if (worst >= 0) { const x = L[worst]; add({ id: 'tranche-ltv', sev: 'warn', title: `LTV reaches ${pctf(x.ltv)} after tranche ${worst + 1} (${dayf(x.date)})`, why: `Above the ${pctf(m.r.maxLTV, 0)} limit. Balance ${money(x.bal)} against collateral ${money(x.bal / x.ltv)} in that month. Lending value LTV ${pctf(x.fs)}. Condition the tranche on sales, extra collateral or an updated (as-completed) valuation.`, tab: 'inputs', keys: [`tranches.${worst}.amount`] }); }
  }
}
